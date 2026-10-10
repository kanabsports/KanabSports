import {allowedChannels} from './notification-preferences.js';
import {accessSchema,hasMembership} from './parent-access.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
const bytes=new TextEncoder();
export const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export const digest=async v=>b64(await crypto.subtle.digest('SHA-256',bytes.encode(v)));
export async function pushSchema(db){for(const sql of [
 'CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS push_devices (id TEXT PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,codes TEXT NOT NULL,updated INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS push_attempts (message_id TEXT NOT NULL,device_id TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(message_id,device_id))',
 'CREATE TABLE IF NOT EXISTS push_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL)'
])await db.prepare(sql).run();try{await db.prepare('ALTER TABLE push_devices ADD COLUMN parent_email TEXT').run()}catch{} }
export async function keys(db){let row=await db.prepare('SELECT value FROM push_config WHERE id=1').first();if(!row){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const value=JSON.stringify({publicKey:b64(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)});await db.prepare('INSERT OR IGNORE INTO push_config(id,value) VALUES(1,?)').bind(value).run();row=await db.prepare('SELECT value FROM push_config WHERE id=1').first();}return JSON.parse(row.value);}
export function validEndpoint(value){try{const u=new URL(value);return value.length<2048&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com'))&&u.pathname.length>1;}catch{return false;}}
export async function sendPush(db,device,table='push_devices'){if(!validEndpoint(device.endpoint))return 'invalid';const key=await keys(db),header=b64(bytes.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),claims=b64(bytes.encode(JSON.stringify({aud:new URL(device.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:'mailto:howdy@kanabsports.com'}))),input=header+'.'+claims;const privateKey=await crypto.subtle.importKey('jwk',key.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,bytes.encode(input)));
 // Cloudflare supports follow/manual, not error. Manual returns redirects as
 // non-success responses without forwarding VAPID credentials to another host.
 // No payload: notification text is generic and provided by our service worker.
 const response=await fetch(device.endpoint,{method:'POST',headers:{Authorization:`vapid t=${input}.${signature}, k=${key.publicKey}`,TTL:'3600',Urgency:'normal'},redirect:'manual',signal:AbortSignal.timeout(10000)});
 // Body cleanup must not turn an accepted delivery into a reported failure.
 try{await response.body?.cancel()}catch{};
 if([404,410].includes(response.status)){const safeTable=['coach_push_devices','owner_push_devices','private_push_devices'].includes(table)?table:'push_devices';await db.prepare(`DELETE FROM ${safeTable} WHERE id=?`).bind(device.id).run();return 'expired';}return response.ok?'accepted':'rejected';}
export async function notifyTeam(db,code,messageId){
 await pushSchema(db);await accessSchema(db);
 const rows=((await db.prepare('SELECT id,endpoint,codes,parent_email FROM push_devices').all()).results||[]).filter(device=>JSON.parse(device.codes).includes(code));
 const totals={accepted:0,failed:0};
 const send=async device=>{
  if(device.parent_email&&!(await allowedChannels(db,'parent',device.parent_email,'general')).push)return;
  if(!CONNECTIONS[code]&&!await hasMembership(db,device.parent_email,code))return;
  const claim=await db.prepare("INSERT OR IGNORE INTO push_attempts(message_id,device_id,status,created) VALUES(?,?,'sending',?) RETURNING device_id").bind(messageId,device.id,Date.now()).first();
  if(!claim)return;
  let status='unknown';try{status=await sendPush(db,device);}catch{}
  await db.prepare('UPDATE push_attempts SET status=? WHERE message_id=? AND device_id=?').bind(status,messageId,device.id).run();
  totals[status==='accepted'?'accepted':'failed']++;
 };
 for(let i=0;i<rows.length;i+=5)await Promise.allSettled(rows.slice(i,i+5).map(send));
 return totals;
}


export async function coachPushSchema(db){
 await pushSchema(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS coach_push_devices (id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,updated INTEGER NOT NULL)').run();
 try{await db.prepare('CREATE INDEX IF NOT EXISTS idx_coach_push_devices_coach ON coach_push_devices(coach_id)').run()}catch{}
}

export async function notifyCoach(db,coachId,messageId){
 await coachPushSchema(db);
 const rows=(await db.prepare('SELECT id,endpoint FROM coach_push_devices WHERE coach_id=?').bind(coachId).all()).results||[];
 const totals={accepted:0,failed:0};
 const send=async device=>{
  const attemptId='coach:'+messageId;
  const claim=await db.prepare("INSERT OR IGNORE INTO push_attempts(message_id,device_id,status,created) VALUES(?,?,'sending',?) RETURNING device_id").bind(attemptId,device.id,Date.now()).first();
  if(!claim)return;
  let status='unknown';try{status=await sendPush(db,device,'coach_push_devices')}catch{}
  await db.prepare('UPDATE push_attempts SET status=? WHERE message_id=? AND device_id=?').bind(status,attemptId,device.id).run();
  totals[status==='accepted'?'accepted':'failed']++;
 };
 for(let i=0;i<rows.length;i+=5)await Promise.allSettled(rows.slice(i,i+5).map(send));
 return totals;
}

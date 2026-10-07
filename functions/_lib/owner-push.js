import {pushSchema,sendPush} from './web-push.js';
export async function ownerPushSchema(db){
  await pushSchema(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS owner_push_devices (id TEXT PRIMARY KEY,email TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,updated INTEGER NOT NULL)').run();
}
export async function notifyOwner(db,eventId){
  await ownerPushSchema(db);
  const devices=(await db.prepare('SELECT id,endpoint FROM owner_push_devices').all()).results||[];
  for(let i=0;i<devices.length;i+=5)await Promise.allSettled(devices.slice(i,i+5).map(async device=>{
    const messageId='owner:'+eventId;
    const claim=await db.prepare("INSERT OR IGNORE INTO push_attempts(message_id,device_id,status,created) VALUES(?,?,'sending',?) RETURNING device_id").bind(messageId,device.id,Date.now()).first();
    if(!claim)return;
    let status='failed';try{status=await sendPush(db,device,'owner_push_devices')}catch(error){console.error('Owner notification delivery failed',error.message)}
    await db.prepare('UPDATE push_attempts SET status=? WHERE message_id=? AND device_id=?').bind(status,messageId,device.id).run();
  }));
}
export async function getOwner(request,db){
  const match=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)ks_admin=([^;]+)/);if(!match)return null;
  let token;try{token=decodeURIComponent(match[1])}catch{return null}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
  return db.prepare("SELECT email FROM admin_sessions WHERE token_hash=? AND email='howdy@kanabsports.com' AND datetime(expires_at)>datetime('now') LIMIT 1").bind(hash).first();
}

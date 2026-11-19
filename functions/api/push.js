import {accessSchema,parentSession,hasMembership} from '../_lib/parent-access.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
import {pushSchema,keys,digest,validEndpoint,sendPush} from '../_lib/web-push.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'Notifications are temporarily unavailable.'},503);
 const db=env.SPORTS_DB;
 try{await pushSchema(db);await accessSchema(db);
 if(request.method==='GET')return json({publicKey:(await keys(db)).publicKey,supportsTeamNotifications:true});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(new URL(request.url).origin!=='https://kanabsports.com'||request.headers.get('Origin')!=='https://kanabsports.com')return json({error:'Open Kanab Sports to manage notifications.'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
 const token=String(body.token||'');if(!/^[a-f0-9]{64}$/.test(token)||!validEndpoint(String(body.endpoint||'')))return json({error:'Invalid device subscription.'},400);
 const id=await digest(body.endpoint),tokenHash=await digest(token),existing=await db.prepare('SELECT id,endpoint,token_hash,codes FROM push_devices WHERE id=?').bind(id).first();
 if(existing&&existing.token_hash!==tokenHash)return json({error:'This subscription belongs to a different device setup. Turn notifications off and enable them again.'},403);
 const hour=Math.floor(Date.now()/3600000),ip=await digest(request.headers.get('CF-Connecting-IP')||'unknown');const count=await db.prepare('INSERT INTO push_limits(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(ip+':'+hour).first();if(count.count>60)return json({error:'Please wait before trying again.'},429);
 if(body.action==='subscribe'){
  const requested=[...new Set((Array.isArray(body.codes)?body.codes:[]).map(x=>String(x||'').trim().toUpperCase()))].filter(Boolean);
  if(requested.length>25||requested.some(code=>!/^[A-Z0-9_-]{1,32}$/.test(code)))return json({error:'Choose up to 25 valid team codes for notifications.'},400);
  const parent=await parentSession(request,db);
  // A signed-in parent may enable this device and test push even before school
  // approves their teams. Never subscribe an unapproved team to private alerts.
  const approved=[];
  for(const code of requested)if(CONNECTIONS[code]||await hasMembership(db,parent?.email,code))approved.push(code);
  if(!parent?.email&&!approved.length)return json({error:'Sign in to My Family or save an accessible team before turning on notifications.'},403);
  await db.prepare('INSERT INTO push_devices(id,endpoint,token_hash,codes,updated,parent_email) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET codes=excluded.codes,updated=excluded.updated,parent_email=excluded.parent_email WHERE push_devices.token_hash=excluded.token_hash').bind(id,body.endpoint,tokenHash,JSON.stringify(approved),Date.now(),parent?.email||null).run();
  const stored=await db.prepare('SELECT token_hash FROM push_devices WHERE id=?').bind(id).first();if(stored?.token_hash!==tokenHash)return json({error:'This subscription is already registered.'},409);
  return json({success:true,registeredTeams:approved.length,awaitingApproval:requested.length-approved.length});
 }
 if(body.action==='unsubscribe'){if(existing)await db.prepare('DELETE FROM push_devices WHERE id=? AND token_hash=?').bind(id,tokenHash).run();return json({success:true});}
 if(body.action==='test'){if(!existing)return json({error:'Enable notifications first.'},404);const status=await sendPush(db,existing);return json({status,message:status==='accepted'?'Test accepted by your notification provider. Check this device.':'The provider did not accept the test. Try enabling notifications again.'});}
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Notifications could not be updated. Please try again.'},503);}
}

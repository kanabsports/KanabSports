import {keys,digest,validEndpoint,sendPush} from '../_lib/web-push.js';
import {ownerPushSchema,getOwner} from '../_lib/owner-push.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({error:'Owner notifications are unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    const owner=await getOwner(request,db);if(!owner)return json({error:'Sign in to the Owner Console first.'},401);
    await ownerPushSchema(db);
    if(request.method==='GET')return json({publicKey:(await keys(db)).publicKey});
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open the Owner Console to manage notifications.'},403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
    const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
    let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
    const {action,endpoint,token}=body;
    if(!validEndpoint(String(endpoint||''))||!/^[a-f0-9]{64}$/.test(String(token||'')))return json({error:'Invalid notification subscription.'},400);
    const id=await digest(endpoint),tokenHash=await digest(token);
    const device=await db.prepare('SELECT * FROM owner_push_devices WHERE id=?').bind(id).first();
    if(device&&(device.email!==owner.email||device.token_hash!==tokenHash))return json({error:'This subscription does not match this device. Reset browser notification permission and try again.'},409);
    if(action==='subscribe'){
      await db.prepare(`INSERT INTO owner_push_devices(id,email,endpoint,token_hash,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated`).bind(id,owner.email,endpoint,tokenHash,Date.now()).run();return json({success:true});
    }
    if(action==='unsubscribe'){
      await db.prepare('DELETE FROM owner_push_devices WHERE id=? AND email=? AND token_hash=?').bind(id,owner.email,tokenHash).run();return json({success:true});
    }
    if(action==='test'){
      if(!device)return json({error:'Enable notifications on this device first.'},404);
      const status=await sendPush(db,device,'owner_push_devices');
      return json({success:status==='accepted',status,message:status==='accepted'?'Test accepted by the notification service. Check this device for an Owner Console alert.':'Test was not accepted. Disable and re-enable notifications to reconnect.'},status==='accepted'?200:502);
    }
    return json({error:'Unknown notification action.'},400);
  }catch(error){console.error('owner push error',error.message);return json({error:'Notifications are temporarily unavailable. Please retry.'},503)}
}

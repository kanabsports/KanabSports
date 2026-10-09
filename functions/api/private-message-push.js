import {json} from '../_lib/coach-auth.js';
import {schema,identity,throttle} from '../_lib/private-messages.js';
import {pushSchema,keys,digest,validEndpoint,sendPush} from '../_lib/web-push.js';
export async function onRequest({request,env}){
 if(env.PRIVATE_MESSAGING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Private messaging pilot is not enabled.'},503);
 const db=env.SPORTS_DB,url=new URL(request.url);
 try{
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json({error:'Open Pep to manage notifications.'},403);
 const actor=await identity(request,db,url.searchParams.get('role'));if(!actor)return json({error:'Sign in first.'},401);
 await schema(db);await pushSchema(db);
 if(request.method==='GET')return json({publicKey:(await keys(db)).publicKey});
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
 let b;try{b=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
 if(!b||!validEndpoint(String(b.endpoint||''))||!/^[a-f0-9]{64}$/.test(String(b.token||'')))return json({error:'Invalid subscription.'},400);
 if(!await throttle(db,actor))return json({error:'Please wait a minute.'},429);
 const id=await digest(b.endpoint),hash=await digest(b.token),existing=await db.prepare('SELECT * FROM private_push_devices WHERE id=?').bind(id).first();
 if(existing&&(existing.token_hash!==hash||existing.role!==actor.role||existing.identity!==actor.id))return json({error:'This subscription belongs to another account. Use that account to turn it off first, or reset browser notification permissions.'},409);
 if(b.action==='subscribe'){
 await db.prepare('INSERT INTO private_push_devices VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated WHERE private_push_devices.token_hash=excluded.token_hash AND private_push_devices.role=excluded.role AND private_push_devices.identity=excluded.identity').bind(id,b.endpoint,actor.role,actor.id,hash,Date.now()).run();
 const saved=await db.prepare('SELECT identity,role,token_hash FROM private_push_devices WHERE id=?').bind(id).first();
 if(saved.identity!==actor.id||saved.role!==actor.role||saved.token_hash!==hash)return json({error:'Subscription belongs to another account.'},409);
 return json({success:true});
 }
 if(b.action==='unsubscribe'){await db.prepare('DELETE FROM private_push_devices WHERE id=? AND identity=? AND role=? AND token_hash=?').bind(id,actor.id,actor.role,hash).run();return json({success:true});}
 if(b.action==='test'){if(!existing)return json({error:'Enable notifications first.'},404);return json({status:await sendPush(db,existing,'private_push_devices')});}
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Notifications could not be updated.'},503);}
}

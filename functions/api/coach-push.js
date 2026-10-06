import {getCoach,ensureCoachCore,sameOrigin,json} from '../_lib/coach-auth.js';
import {coachPushSchema,keys,digest,validEndpoint,sendPush} from '../_lib/web-push.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({error:'Coach notifications are temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await coachPushSchema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({error:'Sign in with your coach account first.'},401);

    if(request.method==='GET')return json({publicKey:(await keys(db)).publicKey,coach:{id:coach.id,name:coach.name}});

    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(!sameOrigin(request))return json({error:'Open the Coach Portal at kanabsports.com.'},403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
    const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
    let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}

    const token=String(body.token||''),endpoint=String(body.endpoint||'');
    if(!/^[a-f0-9]{64}$/.test(token)||!validEndpoint(endpoint))return json({error:'Invalid device subscription.'},400);
    const id=await digest(endpoint),tokenHash=await digest(token);
    const existing=await db.prepare('SELECT id,coach_id,endpoint,token_hash FROM coach_push_devices WHERE id=?').bind(id).first();

    if(body.action==='subscribe'){
      if(existing&&(existing.token_hash!==tokenHash||existing.coach_id!==coach.id))return json({error:'This device subscription belongs to another coach setup. Turn notifications off and enable them again.'},409);
      await db.prepare(`INSERT INTO coach_push_devices(id,coach_id,endpoint,token_hash,updated)
        VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET coach_id=excluded.coach_id,endpoint=excluded.endpoint,token_hash=excluded.token_hash,updated=excluded.updated`)
        .bind(id,coach.id,endpoint,tokenHash,Date.now()).run();
      return json({success:true});
    }

    if(body.action==='unsubscribe'){
      await db.prepare('DELETE FROM coach_push_devices WHERE id=? AND coach_id=? AND token_hash=?').bind(id,coach.id,tokenHash).run();
      return json({success:true});
    }

    if(body.action==='test'){
      if(!existing||existing.coach_id!==coach.id||existing.token_hash!==tokenHash)return json({error:'Enable coach notifications first.'},404);
      const status=await sendPush(db,existing,'coach_push_devices');
      return json({status,message:status==='accepted'?'Test accepted. Check this device for a Coach Portal notification.':'The notification provider did not accept the test. Try enabling notifications again.'});
    }

    return json({error:'Unknown action.'},400);
  }catch(error){
    console.error('coach push error',error);
    return json({error:'Coach notifications could not be updated.'},503);
  }
}
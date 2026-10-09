import {accessSchema,parentSession} from '../_lib/parent-access.js';
import {onRequestGet as teamConnection} from './team-connection.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
import {clean,validEmail,json,sha256} from '../_lib/coach-auth.js';
import {sendEmail} from '../_lib/score-invitations.js';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({success:false,error:'Driver plans are unavailable.'},503);
 try{
  await accessSchema(db);
  const parent=await parentSession(request,db);if(!parent)return json({success:false,error:'Sign in to My Family to save drivers and send reminders.'},401);
  await db.prepare(`CREATE TABLE IF NOT EXISTS family_driver_plans(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,team_code TEXT NOT NULL,event_id TEXT NOT NULL,driver_name TEXT NOT NULL,driver_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'saved',provider_id TEXT,remind_at TEXT,last_error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`).run();
  if(request.method==='GET')return json({success:true,plans:(await db.prepare('SELECT id,team_code,event_id,driver_name,driver_email,status,remind_at,last_error FROM family_driver_plans WHERE owner_email=? ORDER BY updated_at DESC LIMIT 100').bind(parent.email).all()).results||[]});
  if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({success:false,error:'Open My Family to manage drivers.'},403);
  const raw=await request.text();if(raw.length>4000)return json({success:false,error:'Request too large.'},413);
  const body=JSON.parse(raw),action=clean(body.action,30),code=clean(body.team_code,32),eventId=clean(body.event_id,100),now=new Date().toISOString();
  if(!await db.prepare('SELECT entry_id FROM parent_family WHERE email=? AND team_code=? LIMIT 1').bind(parent.email,code).first())return json({success:false,error:'Save this team to your family account first.'},403);
  let team=CONNECTIONS[code];
  if(!team){const url=new URL('/api/team-connection',request.url);url.searchParams.set('code',code);const response=await teamConnection({env,request:new Request(url,{headers:request.headers})});const result=await response.json();if(!response.ok)return json({success:false,error:result.error},response.status);team=result.team;}
  const event=team.events.find(e=>e.id===eventId);if(!event)return json({success:false,error:'This event is no longer on the team schedule.'},404);
  const id=await sha256(parent.email+'|'+code+'|'+eventId);
  const previous=await db.prepare('SELECT * FROM family_driver_plans WHERE id=? AND owner_email=?').bind(id,parent.email).first();
  if(action==='save'){
   const name=clean(body.driver_name,80),email=clean(body.driver_email,254).toLowerCase();
   if(!name||!validEmail(email))return json({success:false,error:'Enter a driver name and valid email address.'},400);
   if(previous&&['scheduled','pending'].includes(previous.status))return json({success:false,error:'Cancel the queued reminder before changing the driver.'},409);
   const saved=await db.prepare(`INSERT INTO family_driver_plans(id,owner_email,team_code,event_id,driver_name,driver_email,status,updated_at) VALUES(?,?,?,?,?,?,'saved',?) ON CONFLICT(id) DO UPDATE SET driver_name=excluded.driver_name,driver_email=excluded.driver_email,status='saved',last_error=NULL,provider_id=NULL,remind_at=NULL,updated_at=excluded.updated_at WHERE family_driver_plans.status NOT IN ('pending','scheduled')`).bind(id,parent.email,code,eventId,name,email,now).run();
   if(!(saved.meta?.changes??saved.changes))return json({success:false,error:'A reminder is being scheduled. Cancel it before changing drivers.'},409);
   return json({success:true,message:'Driver saved. Choose Send Reminder or Schedule Reminder to notify them.'});
  }
  if(!previous)return json({success:false,error:'Save a driver first.'},400);
  if(action==='check_delivery'){
   if(!previous.provider_id)return json({success:false,error:'There is no provider receipt yet.'},409);
   const r=await fetch(`https://api.resend.com/emails/${encodeURIComponent(previous.provider_id)}`,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15000)});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json({success:false,error:'The provider could not return delivery status. Its API key may require read access.'},502);
   const event=clean(d.last_event,40),failed=['failed','bounced','suppressed','complained'].includes(event);
   const status=failed?'failed':['sent','delivered','opened','clicked'].includes(event)?'accepted':previous.status;
   await db.prepare('UPDATE family_driver_plans SET status=?,last_error=? WHERE id=?').bind(status,failed?`Provider reports ${event}.`:null,id).run();
   return json({success:!failed,message:`Provider status: ${event||'unknown'}. Inbox placement is not guaranteed.`,error:failed?`Provider reports ${event}.`:undefined},failed?502:200);
  }
  if(action==='cancel'){
   if(previous.status!=='scheduled'||!previous.provider_id)return json({success:false,error:'There is no scheduled reminder to cancel.'},409);
   const r=await fetch(`https://api.resend.com/emails/${encodeURIComponent(previous.provider_id)}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15000)});
   if(!r.ok)return json({success:false,error:'The provider could not cancel this reminder. It may already have been sent. Check delivery before changing the driver.'},502);
   await db.prepare("UPDATE family_driver_plans SET status='cancelled',updated_at=? WHERE id=?").bind(now,id).run();return json({success:true,message:'The provider cancelled the scheduled reminder.'});
  }
  if(action!=='remind')return json({success:false,error:'Unknown action.'},400);
  const remindAt=body.remind_at?new Date(body.remind_at):null;
  if(remindAt&&(!Number.isFinite(remindAt.getTime())||remindAt.getTime()<Date.now()+60000||remindAt.getTime()>Date.now()+30*86400000))return json({success:false,error:'Choose a reminder time between one minute and 30 days from now.'},400);
  if(['pending','scheduled'].includes(previous.status))return json({success:false,error:'A reminder is already pending or scheduled. Cancel it before scheduling another.'},409);
  const lock=await db.prepare("UPDATE family_driver_plans SET status='pending',attempt=attempt+1,updated_at=? WHERE id=? AND status NOT IN ('pending','scheduled') AND (status<>'accepted' OR datetime(updated_at)<datetime('now','-5 minutes'))").bind(now,id).run();
  if(!(lock.meta?.changes??lock.changes))return json({success:false,error:'A reminder was just sent or is being sent. Wait five minutes before retrying.'},409);
  const text=`Hi ${previous.driver_name},\n\nYou are the selected driver for ${team.name}.\n${event.title}\n${event.date} · ${event.time}\n${event.detail||''}\n\nPlease confirm pickup details with the parent who arranged this ride. Event details can change; check with the family before travelling.\n\nSent at the request of ${parent.email}.`;
  const sent=await sendEmail(env,{to:[previous.driver_email],reply_to:parent.email,subject:`Driver reminder · ${team.name}`,text,...(remindAt?{scheduled_at:remindAt.toISOString()}:{})},`driver-${id}-${previous.attempt+1}`);
  await db.prepare('UPDATE family_driver_plans SET status=?,provider_id=?,remind_at=?,last_error=?,updated_at=? WHERE id=?').bind(sent.accepted?(remindAt?'scheduled':'accepted'):'failed',sent.id||null,remindAt?.toISOString()||null,sent.error||null,now,id).run();
  return json({success:sent.accepted,message:sent.accepted?(remindAt?'The provider accepted your scheduled reminder.':'The provider accepted the driver reminder. Inbox delivery is not confirmed.'):undefined,error:sent.error},sent.accepted?200:502);
 }catch(error){console.error('family driver request failed',error?.name);return json({success:false,error:'Could not complete the driver request. Check the saved status before retrying.'},500)}
}

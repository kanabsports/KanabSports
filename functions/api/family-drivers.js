import {allowedChannels} from '../_lib/notification-preferences.js';
import {sharingSchema,delegated} from '../_lib/family-sharing.js';
import {BLOCKED_REMINDER_STATES,BLOCKED_REMINDER_SQL,DRIVER_PLAN_FIELDS,driverSchema,cancelDriverReminder,checkDriverDelivery} from '../_lib/driver-reminders.js';
import {scheduleEvents,scheduleSchema} from '../_lib/team-schedule.js';
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
  await driverSchema(db);await scheduleSchema(db);
  if(request.method==='GET'){
   const plans=(await db.prepare(`SELECT ${DRIVER_PLAN_FIELDS} FROM family_driver_plans WHERE owner_email=? ORDER BY updated_at DESC LIMIT 100`).bind(parent.email).all()).results||[];
   if(env.FAMILY_SHARING_ENABLED==='true'){
    await sharingSchema(db);const grants=(await db.prepare("SELECT owner_email,team_codes FROM family_delegates WHERE recipient_email=? AND status='active'").bind(parent.email).all()).results||[];
    for(const grant of grants)for(const code of JSON.parse(grant.team_codes)){const access=await delegated(db,parent.email,grant.owner_email,code);if(access){const shared=(await db.prepare(`SELECT ${DRIVER_PLAN_FIELDS} FROM family_driver_plans WHERE owner_email=? AND team_code=?`).bind(grant.owner_email,code).all()).results||[];plans.push(...shared.map(p=>({...p,can_edit:!!access.can_edit})));}}
   }
   return json({success:true,plans});
  }
  if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({success:false,error:'Open My Family to manage drivers.'},403);
  const raw=await request.text();if(raw.length>4000)return json({success:false,error:'Request too large.'},413);
  const body=JSON.parse(raw),action=clean(body.action,30),code=clean(body.team_code,32),eventId=clean(body.event_id,100),now=new Date().toISOString();
  const owner=String(body.owner_email||parent.email).toLowerCase();
  if(owner!==parent.email&&(env.FAMILY_SHARING_ENABLED!=='true'||!await delegated(db,parent.email,owner,code,true)))return json({success:false,error:'The head parent has not given you edit permission for this schedule.'},403);
  const editGuard=owner===parent.email?'1=1':"EXISTS(SELECT 1 FROM family_delegates fg WHERE fg.owner_email=? AND fg.recipient_email=? AND fg.status='active' AND fg.can_edit=1 AND EXISTS(SELECT 1 FROM json_each(fg.team_codes) WHERE value=?))";
  const editArgs=owner===parent.email?[]:[owner,parent.email,code];
  if(!await db.prepare('SELECT entry_id FROM parent_family WHERE email=? AND team_code=? LIMIT 1').bind(owner,code).first())return json({success:false,error:'Save this team to your family account first.'},403);
  let team=CONNECTIONS[code];
  if(!team&&owner!==parent.email){const row=await db.prepare("SELECT team_name,organization FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(code).first();team={name:row?.team_name||row?.organization||code,events:await scheduleEvents(db,code)};}
  if(!team){const url=new URL('/api/team-connection',request.url);url.searchParams.set('code',code);const response=await teamConnection({env,request:new Request(url,{headers:request.headers})});const result=await response.json();if(!response.ok)return json({success:false,error:result.error},response.status);team=result.team;}
  if(!CONNECTIONS[code])team.events=await scheduleEvents(db,code);
  const event=team.events.find(e=>e.id===eventId);if(!event&&!['cancel','check_delivery'].includes(action))return json({success:false,error:'This event is no longer on the team schedule.'},404);
  if(event?.cancelled&&!['cancel','check_delivery'].includes(action))return json({success:false,error:'This event is cancelled. No replacement reminder can be sent. Check the existing reminder status.'},409);
  const id=await sha256(owner+'|'+code+'|'+eventId);
  const previous=await db.prepare('SELECT * FROM family_driver_plans WHERE id=? AND owner_email=?').bind(id,owner).first();
  if(action==='save'){
   const name=clean(body.driver_name,80),email=clean(body.driver_email,254).toLowerCase();
   if(!name||!validEmail(email))return json({success:false,error:'Enter a driver name and valid email address.'},400);
   if(env.FAMILY_SHARING_ENABLED==='true'){await sharingSchema(db);const grant=await db.prepare("SELECT is_driver,status FROM family_delegates WHERE owner_email=? AND recipient_email=?").bind(owner,email).first();if(grant&&(grant.status!=='active'||!grant.is_driver))return json({success:false,error:'The head parent must give this trusted person driver permission first.'},403);}
   if(previous&&BLOCKED_REMINDER_STATES.includes(previous.status))return json({success:false,error:'Resolve the pending reminder or cancellation before changing the driver.'},409);
   const saved=await db.prepare(`INSERT INTO family_driver_plans(id,owner_email,team_code,event_id,driver_name,driver_email,status,updated_at) SELECT ?,?,?,?,?,?,'saved',? WHERE ${editGuard} ON CONFLICT(id) DO UPDATE SET driver_name=excluded.driver_name,driver_email=excluded.driver_email,status='saved',last_error=CASE WHEN family_driver_plans.review_required=1 THEN family_driver_plans.last_error ELSE NULL END,provider_id=NULL,remind_at=NULL,event_token_hash=NULL,event_token_expires=NULL,updated_at=excluded.updated_at WHERE family_driver_plans.status NOT IN (${BLOCKED_REMINDER_SQL}) AND ${editGuard}`).bind(id,owner,code,eventId,name,email,now,...editArgs,...editArgs).run();
   if(!(saved.meta?.changes??saved.changes))return json({success:false,error:'A reminder is being scheduled. Cancel it before changing drivers.'},409);
   return json({success:true,message:'Driver saved. Choose Send Reminder or Schedule Reminder to notify them.'});
  }
  if(!previous)return json({success:false,error:'Save a driver first.'},400);
  if(action==='check_delivery'){
   if(!previous.provider_id)return json({success:false,error:'There is no provider receipt yet. Acceptance may be unresolved; do not send a duplicate reminder.'},409);
   const result=await checkDriverDelivery(db,env,previous);
   return json({success:result.ok,message:result.ok?result.message:undefined,error:result.ok?undefined:result.message},result.ok?200:502);
  }
  if(action==='cancel'){
   const result=await cancelDriverReminder(db,env,previous);
   return json({success:result.ok,message:result.ok?result.message:undefined,error:result.ok?undefined:result.message},result.ok?200:502);
  }
  if(action!=='remind')return json({success:false,error:'Unknown action.'},400);
  const remindAt=body.remind_at?new Date(body.remind_at):null;
  if(remindAt&&(!Number.isFinite(remindAt.getTime())||remindAt.getTime()<Date.now()+60000||remindAt.getTime()>Date.now()+30*86400000))return json({success:false,error:'Choose a reminder time between one minute and 30 days from now.'},400);
  if(BLOCKED_REMINDER_STATES.includes(previous.status))return json({success:false,error:'A reminder or cancellation is unresolved. Check delivery or retry cancellation before scheduling another.'},409);
  const revision=event.revision||0;
  if((body.event_revision??0)!==revision)return json({success:false,error:'The event changed. Refresh and review the current time and location before authorizing a reminder.'},409);
  const currentRevision="COALESCE((SELECT revision FROM team_schedule_changes WHERE team_code=? AND event_id=?),0)=?";
  const lock=await db.prepare(`UPDATE family_driver_plans SET status='pending',attempt=attempt+1,provider_id=NULL,remind_at=?,last_error=NULL,
    reminder_revision=?,review_required=0,event_cancelled=0,cancel_token=NULL,cancel_started=NULL,updated_at=?
    WHERE id=? AND attempt=? AND status NOT IN (${BLOCKED_REMINDER_SQL})
    AND (status<>'accepted' OR datetime(updated_at)<datetime('now','-5 minutes')) AND ${editGuard} AND ${currentRevision} RETURNING *`)
    .bind(remindAt?.toISOString()||null,revision,now,id,previous.attempt,...editArgs,code,eventId,revision).first();
  if(!lock)return json({success:false,error:'The schedule, permissions, or reminder changed. Refresh before trying again.'},409);
  if(!(await allowedChannels(db,'parent',lock.driver_email,'logistics')).email){await db.prepare("UPDATE family_driver_plans SET status='muted',updated_at=? WHERE id=? AND attempt=? AND status='pending'").bind(now,id,lock.attempt).run();return json({success:true,message:'This driver has muted logistics emails. The driver plan is saved; no email was sent.'});}
  // Recheck after asynchronous preference work. A change during provider I/O is
  // handled by the trigger plus the fenced receipt update below.
  const ready=await db.prepare(`UPDATE family_driver_plans SET updated_at=? WHERE id=? AND attempt=? AND status='pending'
    AND review_required=0 AND ${currentRevision} AND ${editGuard} RETURNING id`).bind(now,id,lock.attempt,code,eventId,revision,...editArgs).first();
  if(!ready){await db.prepare("UPDATE family_driver_plans SET status='saved' WHERE id=? AND attempt=? AND status='pending'").bind(id,lock.attempt).run();return json({success:false,error:'The schedule or permissions changed before sending. Refresh and review the driver plan.'},409);}
   const eventToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const tokenSaved=await db.prepare("UPDATE family_driver_plans SET event_token_hash=?,event_token_expires=? WHERE id=? AND attempt=? AND status='pending' AND review_required=0 RETURNING id").bind(await sha256(eventToken),Date.now()+45*86400000,id,lock.attempt).first();
   if(!tokenSaved)return json({success:false,error:'The event changed before sending. Refresh the driver plan.'},409);
   const eventUrl=new URL('/api/driver-event?token='+eventToken,request.url).href;
  const text=`Hi ${lock.driver_name},\n\nThe parent who selected you as a driver has asked you to check the current travel details for ${team.name}.\n\nOpen current event details: ${eventUrl}\n\nThis private link shows only this event, not the family roster or messages. It expires after 45 days or when this reminder is cancelled or replaced. Confirm pickup and whether the ride is still needed with ${parent.email}.\n\nSent at the request of ${parent.email}.`;
  const sent=await sendEmail(env,{to:[lock.driver_email],reply_to:parent.email,subject:`Driver reminder · ${team.name}`,text,...(remindAt?{scheduled_at:remindAt.toISOString()}:{})},`driver-${id}-${lock.attempt}`);
  // A malformed success or server error can hide provider acceptance. Keep the
  // attempt blocked instead of allowing a fresh idempotency key to duplicate it.
  const uncertain=sent.delivery==='unconfirmed'||sent.http_status>=500||sent.http_status===408||(sent.http_status>=200&&sent.http_status<300);
  const status=sent.accepted?(remindAt?'scheduled':'accepted'):(uncertain?'send_unconfirmed':'failed');
  const error=uncertain?'Provider acceptance is unconfirmed. Do not send another reminder; provider reconciliation is required.':sent.error||null;
  const completed=await db.prepare(`UPDATE family_driver_plans SET status=CASE
    WHEN review_required=1 AND ?='scheduled' THEN 'cancel_pending'
    WHEN review_required=1 AND ?='accepted' THEN 'stale_sent' ELSE ? END,
    provider_id=?,last_error=?,updated_at=? WHERE id=? AND attempt=? AND status='pending' RETURNING *`)
    .bind(status,status,status,sent.id||null,error,new Date().toISOString(),id,lock.attempt).first();
  if(completed?.status==='cancel_pending')await cancelDriverReminder(db,env,completed);
  if(completed?.review_required)return json({success:false,error:'The event changed while the reminder was being sent. Review its cancellation/delivery status. No replacement has been sent.'},409);
  return json({success:sent.accepted,message:sent.accepted?(remindAt?'The provider accepted your scheduled reminder.':'The provider accepted the driver reminder. Inbox delivery is not confirmed.'):undefined,error},sent.accepted?200:502);
 }catch(error){console.error('family driver request failed',error?.name);return json({success:false,error:'Could not complete the driver request. Check the saved status before retrying.'},500)}
}

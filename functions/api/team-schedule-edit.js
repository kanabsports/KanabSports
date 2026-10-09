import {getCoach,json,canManageAssistants} from '../_lib/coach-auth.js';
import {schema,eligibleSQL} from '../_lib/private-messages.js';
import {scheduleEvents,scheduleSchema} from '../_lib/team-schedule.js';
import {notifySchedule} from '../_lib/schedule-notifications.js';
export async function onRequest({request,env,waitUntil}){
 if(env.PRIVATE_MESSAGING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Team tools pilot is not enabled.'},503);
 try{const db=env.SPORTS_DB,url=new URL(request.url),coach=await getCoach(request,db);if(!coach)return json({error:'Sign in with your approved coach account.'},401);await schema(db);await scheduleSchema(db);
 if(request.method==='GET'){const teams=(await db.prepare(eligibleSQL+' AND a.id=?').bind(coach.id).all()).results||[];for(const t of teams)t.events=await scheduleEvents(db,t.team_code);return json({teams,can_edit:canManageAssistants(coach)});}
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);if(request.headers.get('Origin')!==url.origin)return json({error:'Open the Coach Portal to edit schedules.'},403);
 if(!canManageAssistants(coach))return json({error:'Only the approved head coach can edit the team schedule in this pilot.'},403);
 const raw=await request.text();if(raw.length>4000)return json({error:'Request too large.'},413);const b=JSON.parse(raw),code=String(b.team_code||'');
 if(!await db.prepare(eligibleSQL+' AND a.id=? AND t.team_code=?').bind(coach.id,code).first())return json({error:'This team is not available.'},403);
 const current=(await scheduleEvents(db,code)).find(e=>e.id===b.event_id);if(!current)return json({error:'Event no longer exists in the approved schedule.'},404);
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date+'T00:00:00Z'))||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date||typeof b.time!=='string'||b.time.length>50||typeof b.title!=='string'||!b.title.trim()||b.title.length>140||typeof b.detail!=='string'||b.detail.length>300||typeof b.cancelled!=='boolean'||!Number.isInteger(b.revision))return json({error:'Enter a valid date, time, title and location.'},400);
 if(b.revision!==current.revision)return json({error:'Another change was saved. Refresh before editing.'},409);
 const result=await db.prepare(`INSERT INTO team_schedule_changes SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_message_teams t JOIN private_message_coaches pc ON pc.team_code=t.team_code JOIN school_teams s ON s.team_code=t.team_code JOIN coach_access_requests a ON a.id=pc.coach_id WHERE t.team_code=? AND t.enabled=1 AND pc.coach_id=? AND pc.active=1 AND a.status='approved' AND s.kind IN ('rec','travel') AND s.school_id IS NULL) ON CONFLICT(team_code,event_id) DO UPDATE SET date=excluded.date,time=excluded.time,title=excluded.title,detail=excluded.detail,cancelled=excluded.cancelled,revision=excluded.revision,actor_id=excluded.actor_id,updated=excluded.updated WHERE team_schedule_changes.revision=?`).bind(code,current.id,b.date,b.time.trim(),b.title.trim(),b.detail.trim(),+b.cancelled,current.revision+1,coach.id,Date.now(),code,coach.id,b.revision).run();
 if(!(result.meta?.changes??result.changes))return json({error:'Access or schedule changed. Refresh and try again.'},409);
 const task=notifySchedule(db,env,code,current.id,current.revision+1);if(waitUntil)waitUntil(task);else await task;
 return json({saved:true,revision:current.revision+1,message:'Schedule saved immediately. Open family screens refresh within five seconds. Review queued driver reminders; they are not automatically rewritten.'});
 }catch{return json({error:'Schedule could not be updated.'},503);}
}

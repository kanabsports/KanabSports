import {getCoach,ensureCoachCore,clean,json} from '../_lib/coach-auth.js';
import {teamPolicy,messagingGate} from '../_lib/school-access.js';
import {teamSchema} from './team-connection.js';
import {teamEvents} from '../_lib/team-events.js';
import {pilotSchema} from '../_lib/pilot-schema.js';
import {notifyTeam} from '../_lib/web-push.js';
import {findBlockedWords,LANGUAGE_NOTE} from '../../assets/pep-language.mjs';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Team schedule unavailable.'},503);
 try{await ensureCoachCore(db);const coach=await getCoach(request,db);if(!coach?.team_code)return json({error:'Sign in as an approved coach with a team code.'},401);
 const code=coach.team_code,policy=await teamPolicy(db,code);if(!['rec','travel'].includes(policy?.kind))return json({error:'This practice workflow is for approved rec/travel teams. School schedules keep their existing approval workflow.'},403);
 await teamSchema(db);await pilotSchema(db);
 if(request.method==='GET')return json({success:true,team:coach.team_name||coach.organization,events:await teamEvents(db,code,true)});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open the Coach Portal to update a practice.'},403);
 const raw=await request.text();if(raw.length>6000)return json({error:'Request too large.'},413);const b=JSON.parse(raw),id=clean(b.event_id,100),changeId=clean(b.change_id,80),expected=b.version;
 if(!/^[\w-]{1,100}$/.test(id)||!/^[\w-]{12,80}$/.test(changeId)||!Number.isSafeInteger(expected)||expected<0)return json({error:'Reload the event before updating.'},400);
 const events=await teamEvents(db,code,true),old=events.find(e=>e.id===id);if((old&&old.type!=='practice')||!id.startsWith('practice-'))return json({error:'Choose an event on your team.'},404);
 const date=clean(b.date,10),time=clean(b.time,12),endTime=clean(b.endTime,12),title=clean(b.title,120),detail=clean(b.detail,240),cancelled=b.cancelled===true;
 const clock=v=>/^([1-9]|1[0-2]):[0-5]\d (AM|PM)$/.test(v);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||!clock(time)||!clock(endTime)||!title||!detail)return json({error:'Enter an event title, valid date, start/end times such as 4:00 PM, and location.'},400);
 if(findBlockedWords(title+' '+detail).length)return json({error:LANGUAGE_NOTE},422);
 const current=await db.prepare('SELECT event_json,version FROM pep_event_changes WHERE team_code=? AND event_id=?').bind(code,id).first();if(current&&JSON.parse(current.event_json).changeId===changeId)return json({success:true,version:current.version,message:'This change was already saved. No duplicate announcement was posted.'});
 if((current?.version||0)!==expected)return json({error:'Another coach changed this event. Reload and review the latest details.'},409);
 const gate=await messagingGate(db,code);if(!gate.allowed)return json({error:gate.reason},403);
 const recent=await db.prepare('SELECT COUNT(*) n FROM pep_event_changes WHERE team_code=? AND updated>?').bind(code,Date.now()-60000).first();if(recent.n>=10)return json({error:'Please wait a minute before making more changes.'},429);
 const version=expected+1,event={id,date,endDate:date,time,endTime,title,detail,type:old?.type||'practice',url:'/',cancelled,version,changeId};
 const body=`${cancelled?'Cancelled':old?'Schedule changed':'Practice added'}: ${title}\n${date} · ${time}–${endTime}\n${detail}\nPlease open My Family for the current schedule and tap Got it on this update. Driver reminder links show current event details; reminder send times do not automatically move.`;
 const result=await db.batch([
 db.prepare('INSERT INTO pep_event_changes VALUES(?,?,?,?,?) ON CONFLICT(team_code,event_id) DO UPDATE SET event_json=excluded.event_json,version=excluded.version,updated=excluded.updated WHERE pep_event_changes.version=?').bind(code,id,JSON.stringify(event),version,Date.now(),expected),
 db.prepare("INSERT INTO coach_team_messages(id,coach_id,team_code,author,body,created_at) SELECT ?,?,?,?,?,datetime('now') FROM pep_event_changes WHERE team_code=? AND event_id=? AND json_extract(event_json,'$.changeId')=?").bind(changeId,coach.id,code,coach.name,body,code,id,changeId)
 ]);
 if(!(result[0].meta?.changes??result[0].changes))return json({error:'Another coach updated the event. Reload before trying again.'},409);
 let pushed={accepted:0,failed:0};if(result[1].meta?.changes??result[1].changes){try{pushed=await notifyTeam(db,code,changeId)}catch{pushed.failed=1}}
 return json({success:true,version,push:pushed,message:'Schedule and family announcement saved together. '+(pushed.accepted?'App notifications accepted; delivery and reading are not confirmed.':'No app notification was confirmed. The update remains in My Family until acknowledged.')});
 }catch{return json({error:'Could not confirm the change. Retry this same form before creating another update.'},500)}
}

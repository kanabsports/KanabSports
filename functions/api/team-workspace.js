import {notifyTeam} from '../_lib/web-push.js';
import {identity,json,schema,session,authorized,sameOrigin,limit,seedSignupRecords,notifyHead} from '../_lib/pilot.js';
import {TEAM_D} from '../../assets/team-d-data.js';
export async function onRequest({request,env,waitUntil}){
 if(!env.SPORTS_DB)return json({error:'Team workspace is temporarily unavailable.'},503);
 const db=env.SPORTS_DB;
 try{
 await schema(db);
 if(request.method==='GET'){
  const announcements=(await db.prepare('SELECT id,author,body,created FROM team_d_announcements ORDER BY created DESC LIMIT 50').all()).results||[];
  const result={team:TEAM_D,announcements,smsEnrollmentConfigured:!!env.TWILIO_AUTH_TOKEN};
  if(new URL(request.url).searchParams.get('view')==='public')return json(result);
  const member=await session(request,db);if(!member)return json({error:'Sign in to open your team.'},401);
  await seedSignupRecords(db);
  result.member={id:member.id,name:member.name,role:member.role,status:member.status};
  const joined=(await db.prepare('SELECT m.email,m.joined,a.status FROM team_d_members m LEFT JOIN team_d_approvals a ON a.email=m.email').all()).results||[];
  result.coaches=[];
  for(const row of joined){const person=await identity(row.email);if(person&&person.id!=='amber')result.coaches.push({...person,joined:row.joined,status:row.status||'pending'});}
  if(member.id==='amber'){
   result.notifications=(await db.prepare('SELECT coach_name,created,sent_at FROM team_d_notifications ORDER BY created DESC').all()).results||[];
   result.alertsActive=!!await db.prepare("SELECT value FROM team_d_settings WHERE key='head_email'").first();
   if(waitUntil)waitUntil(notifyHead(env));
  }
  return json(result);
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!sameOrigin(request))return json({error:'Open your portal at kanabsports.com.'},403);
 const member=await authorized(request,db);if(!member)return json({error:'Your coaching access is awaiting approval. Amber can approve it in her portal.'},403);
 const raw=await request.text();if(raw.length>6000)return json({error:'Message is too long.'},413);
 let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400);}
 if(body.action==='review'){
  if(member.id!=='amber')return json({error:'Only the head coach can review coach access.'},403);
  if(!['approved','denied'].includes(body.status)||!['britt','jodi'].includes(body.coachId))return json({error:'Choose a coach and approval status.'},400);
  const rows=(await db.prepare('SELECT email FROM team_d_members').all()).results||[];
  let target;for(const row of rows)if((await identity(row.email))?.id===body.coachId)target=row.email;
  if(!target)return json({error:'This coach has not signed up yet.'},404);
  await db.prepare('INSERT INTO team_d_approvals(email,status,reviewed_by,reviewed_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at').bind(target,body.status,member.id,Date.now()).run();
  return json({success:true});
 }
 if(body.action==='announce'){
  const message=String(body.body||'').trim();if(!message||message.length>1200)return json({error:'Write an update of 1–1,200 characters.'},400);
  if(!await limit(db,`announcement:${member.id}:${Math.floor(Date.now()/60000)}`,5))return json({error:'Please wait a minute before posting another update.'},429);
  const id=crypto.randomUUID();await db.prepare('INSERT INTO team_d_announcements(id,author,body,created) VALUES(?,?,?,?)').bind(id,member.name,message,Date.now()).run();
  if(waitUntil)waitUntil(notifyTeam(db,'TEAM-D',id).catch(()=>{}));
  return json({success:true,id,message:'Published to the team page and My Family. App notifications queued for opted-in devices. No SMS sent.'});
 }
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Could not load or save your team. Please try again.'},500);}
}

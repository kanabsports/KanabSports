import {identity,messagingOrigin,throttle,eligibleSQL} from '../_lib/private-messages.js';
import {audienceSchema,channels} from '../_lib/pep-audiences.js';
import {studentSession} from './student-pep-access.js';
import {json} from '../_lib/coach-auth.js';
import {sendEmail} from '../_lib/score-invitations.js';
import {allowedChannels} from '../_lib/notification-preferences.js';
import {notifyCoach,sendPush,pushSchema} from '../_lib/web-push.js';
import {findBlockedWords,LANGUAGE_NOTE} from '../../assets/pep-language.mjs';

async function notify(db,env,actor,scope,code,org,enrollment,id){
  const matches=()=>db.prepare('SELECT * FROM ('+scope.sql+') WHERE team_code=? AND organization_id=? AND enrollment=? LIMIT 1').bind(...scope.args,code,org,enrollment).first();
  const thread=await matches();if(!thread)return;
  if(!enrollment){
    const others=(await db.prepare(eligibleSQL+' AND t.team_code=? AND t.organization_id=? AND a.id<>?').bind(code,org,actor.id).all()).results;
    for(const c of others){
      const member=await db.prepare(eligibleSQL+' AND t.team_code=? AND t.organization_id=? AND a.id=?').bind(code,org,c.coach_id).first();
      if(member&&(await allowedChannels(db,'coach',c.coach_id,'general')).push&&await matches())await notifyCoach(db,c.coach_id,id);
    }
    return;
  }
  const prefs=await allowedChannels(db,'parent',thread.parent_email,'general');
  for(const [role,email] of [['parent',thread.parent_email],['student',thread.student_email]]){
    if((role==='parent'&&!prefs.email)||!await matches())continue;
    await sendEmail(env,{to:[email],subject:'A shared Pep Talk is ready',text:'Sign in to see the update shared with the athlete and guardian. '+messagingOrigin(env)+'/messages/team.html?role='+role},'pep-shared-'+id+'-'+role);
  }
  if(!prefs.push)return;
  await pushSchema(db);
  const devices=(await db.prepare(`SELECT id,endpoint,'push_devices' AS source FROM push_devices WHERE parent_email=? AND EXISTS(SELECT 1 FROM json_each(codes) WHERE value=?)
    UNION ALL SELECT id,endpoint,'private_push_devices' AS source FROM private_push_devices WHERE role='parent' AND identity=?`).bind(thread.parent_email,code,thread.parent_email).all()).results;
  const used=new Set();
  for(const device of devices){if(!used.has(device.endpoint)&&await matches()){used.add(device.endpoint);await sendPush(db,device,device.source);}}
}
export async function onRequest({request,env,waitUntil}){
  const db=env.SPORTS_DB;
  if(!db||env.PRIVATE_MESSAGING_ENABLED!=='true')return json({error:'The Pep Talk pilot is not enabled.'},503);
  const url=new URL(request.url),role=url.searchParams.get('role'),studentEnabled=env.PEP_STUDENT_AUDIENCE_ENABLED==='true';
  if(!['coach','parent','student'].includes(role)||(role==='student'&&!studentEnabled))return json({error:'Audience unavailable.'},403);
  try{
    await audienceSchema(db);
    let actor;
    if(role==='student'){const s=await studentSession(request,db);if(s)actor={role,id:s.email};}
    else actor=await identity(request,db,role);
    if(!actor)return json({error:'Sign in to your account.'},401);
    const scope=channels(actor,studentEnabled);
    if(request.method==='GET'){
      if(!scope)return json({channels:[],messages:[]});
      const list=(await db.prepare('SELECT DISTINCT team_code,organization_id,team_name,enrollment,student_ref FROM ('+scope.sql+') ORDER BY team_name,student_ref').bind(...scope.args).all()).results;
      if(!url.searchParams.has('team'))return json({channels:list});
      const code=url.searchParams.get('team'),org=url.searchParams.get('org'),enrollment=url.searchParams.get('group')||'';
      if(!list.some(x=>x.team_code===code&&x.organization_id===org&&x.enrollment===enrollment))return json({error:'This audience is unavailable.'},403);
      const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
      if(!Number.isSafeInteger(before)||before<1)return json({error:'Invalid history page.'},400);
      const messages=(await db.prepare(`SELECT m.sequence,m.author_name,m.created,m.body FROM pep_audience_messages m
        WHERE m.team_code=? AND m.organization_id=? AND m.enrollment=? AND m.sequence<?
        AND EXISTS(SELECT 1 FROM (`+scope.sql+`) s WHERE s.team_code=m.team_code AND s.organization_id=m.organization_id
        AND s.enrollment=m.enrollment AND (m.enrollment='' OR m.author_id=s.coach_id)) ORDER BY m.sequence DESC LIMIT 51`).bind(code,org,enrollment,before,...scope.args).all()).results;
      return json({messages:messages.slice(0,50).reverse(),older:messages.length>50?messages[49].sequence:null});
    }
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(request.headers.get('Origin')!==url.origin)return json({error:'Only the assigned coach can post here.'},403);
    const raw=await request.text();if(raw.length>12000)return json({error:'Request too large.'},413);
    const b=JSON.parse(raw),body=String(b.body||'').trim();
    if(role==='parent'&&b.action==='withdraw'&&studentEnabled){
      const row=await db.prepare(`UPDATE pep_student_enrollments SET active=0 WHERE id=? AND EXISTS(SELECT 1 FROM (`+scope.sql+') s WHERE s.enrollment=pep_student_enrollments.id) RETURNING id').bind(String(b.enrollment||''),...scope.args).first();
      return row?json({withdrawn:true}):json({error:'Enrollment unavailable.'},403);
    }
    if(role!=='coach')return json({error:'Only the assigned coach can post here.'},403);
    if(!body||body.length>4000||!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.id)||typeof b.enrollment!=='string'||typeof b.team_code!=='string'||typeof b.organization_id!=='string')return json({error:'Choose an audience and enter a message.'},400);
    if(findBlockedWords(body).length)return json({error:LANGUAGE_NOTE},422);
    if(!await throttle(db,actor))return json({error:'Wait a minute before sending more Pep Talks.'},429);
    const args=[...scope.args,b.team_code,b.organization_id,b.enrollment];
    const allowed='SELECT 1 FROM ('+scope.sql+') WHERE team_code=? AND organization_id=? AND enrollment=?';
    const row=await db.prepare(`INSERT OR IGNORE INTO pep_audience_messages(id,team_code,organization_id,enrollment,author_id,author_name,body,created)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(`+allowed+') RETURNING id').bind(b.id,b.team_code,b.organization_id,b.enrollment,actor.id,actor.name,body,Date.now(),...args).first();
    if(!row){
      if(!await db.prepare(allowed).bind(...args).first())return json({error:'This audience is unavailable.'},403);
      const saved=await db.prepare('SELECT id FROM pep_audience_messages WHERE id=? AND team_code=? AND organization_id=? AND enrollment=? AND author_id=? AND body=?').bind(b.id,b.team_code,b.organization_id,b.enrollment,actor.id,body).first();
      if(!saved)return json({error:'Message ID is already in use.'},409);
    }else{
      const task=notify(db,env,actor,scope,b.team_code,b.organization_id,b.enrollment,b.id).catch(()=>{});
      if(waitUntil)waitUntil(task);else await task;
    }
    return json({saved:true,id:b.id});
  }catch{return json({error:'Pep Talks are temporarily unavailable.'},503);}
}

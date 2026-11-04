import {parentSession} from '../_lib/parent-access.js';
import {audienceSchema,channels} from '../_lib/pep-audiences.js';
import {json} from '../_lib/coach-auth.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB||env.PRIVATE_MESSAGING_ENABLED!=='true'||env.PEP_STUDENT_AUDIENCE_ENABLED!=='true'){
    return request.method==='GET'?json({enrollments:[]}):json({error:'Athlete access is unavailable.'},403);
  }
  try{
    const db=env.SPORTS_DB,parent=await parentSession(request,db);
    if(!parent)return json({error:'Sign in as the verified guardian.'},401);
    await audienceSchema(db);
    const scope=channels({role:'parent',id:parent.email},true);
    if(request.method==='GET'){
      const rows=(await db.prepare('SELECT DISTINCT s.enrollment,s.student_email,s.team_name,COALESCE(c.enabled,1) enabled FROM ('+scope.sql+') s LEFT JOIN pep_athlete_controls c ON c.enrollment=s.enrollment').bind(...scope.args).all()).results;
      return json({enrollments:rows});
    }
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open My Family to change athlete access.'},403);
    const raw=await request.text();if(raw.length>400)return json({error:'Request too large.'},413);
    const b=JSON.parse(raw);
    if(typeof b.enabled!=='boolean'||typeof b.enrollment!=='string')return json({error:'Choose an athlete and access setting.'},400);
    const row=await db.prepare('INSERT INTO pep_athlete_controls SELECT DISTINCT s.enrollment,? FROM ('+scope.sql+') s WHERE s.enrollment=? ON CONFLICT(enrollment) DO UPDATE SET enabled=excluded.enabled RETURNING enabled').bind(+b.enabled,...scope.args,b.enrollment).first();
    return row?json({enabled:!!row.enabled}):json({error:'Enrollment is unavailable.'},403);
  }catch{return json({error:'Could not load athlete access.'},503);}
}

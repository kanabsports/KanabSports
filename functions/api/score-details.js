import {getCoach,json} from '../_lib/coach-auth.js';

export async function ensureDetails(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS score_details(score_id TEXT PRIMARY KEY,details TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)').run();
}
export async function onRequest({request,env}){
 const db=env.SPORTS_DB,url=new URL(request.url);
 if(!db)return json({error:'Score storage unavailable.'},503);
 if(!['GET','POST'].includes(request.method))return json({error:'Method unavailable.'},405);
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json({error:'Open Scores in the Coach Portal.'},403);
 if(request.method==='GET'&&url.searchParams.get('public')==='1'){
  await ensureDetails(db);
  const row=await db.prepare("SELECT s.team,s.opponent,s.event_date,s.result,d.details FROM score_details d JOIN coach_submissions s ON s.id=d.score_id WHERE s.type='Score' AND s.status='approved' AND s.id=?").bind(url.searchParams.get('id')||'').first();
  return row?json(row):json({error:'Game stats unavailable.'},404);
 }
 const coach=await getCoach(request,db);
 if(!coach||!['head coach','coach','assistant coach'].includes(coach.role.toLowerCase()))return json({error:'Sign in with your approved coach account.'},403);
 await ensureDetails(db);
 const access=` FROM coach_submissions s JOIN coach_access_requests owner ON s.accountable_coach_id=owner.id
 JOIN school_teams t ON t.team_code=owner.team_code WHERE s.type='Score' AND s.status='approved' AND s.id=?
 AND owner.team_code=? AND t.kind IN ('travel','rec') AND t.school_id IS NULL`;
 const id=url.searchParams.get('id')||'';
 if(request.method==='GET'&&!id){
  const list=access.replace(" AND s.id=?","");
  const rows=await db.prepare('SELECT s.id,s.team,s.opponent,s.event_date,s.result'+list+' ORDER BY s.event_date DESC,s.created_at DESC LIMIT 100').bind(coach.team_code).all();
  return json({games:rows.results});
 }
 if(!await db.prepare('SELECT 1'+access).bind(id,coach.team_code).first())return json({error:'Select a published score belonging to your approved recreation or travel team.'},403);
 if(request.method==='GET')return json(await db.prepare('SELECT details,revision FROM score_details WHERE score_id=?').bind(id).first()||{details:'',revision:0});
 const input=await request.json(),details=String(input.details||'').trim();
 if(!details||details.length>8000||!Number.isSafeInteger(input.revision))return json({error:'Review the stats and keep them under 8,000 characters.'},400);
 const saved=await db.prepare('INSERT INTO score_details(score_id,details) SELECT s.id,?'+access+' AND (EXISTS(SELECT 1 FROM score_details WHERE score_id=s.id) OR ?=0) ON CONFLICT(score_id) DO UPDATE SET details=excluded.details,revision=score_details.revision+1 WHERE score_details.revision=? RETURNING revision').bind(details,id,coach.team_code,input.revision,input.revision).first();
 return saved?json(saved):json({error:'This score changed. Reopen its details before saving.'},409);
}

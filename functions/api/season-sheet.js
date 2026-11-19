import {getCoach,json} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB,url=new URL(request.url);
 if(!db)return json({error:'Team storage unavailable.'},503);
 const coach=await getCoach(request,db);
 if(!coach||!coach.team_code||!['head coach','assistant coach','coach'].includes(coach.role.toLowerCase()))return json({error:'Sign in with your approved team account.'},403);
 const allowed=await db.prepare("SELECT 1 FROM school_teams WHERE team_code=? AND kind IN ('travel','rec') AND school_id IS NULL").bind(coach.team_code).first();
 if(!allowed)return json({error:'Season sheets are available for approved travel and recreation teams.'},403);
 await db.prepare('CREATE TABLE IF NOT EXISTS team_season_sheets(team_code TEXT NOT NULL,season TEXT NOT NULL,sheet_id TEXT NOT NULL,PRIMARY KEY(team_code,season))').run();
 const canEdit=['head coach','coach'].includes(coach.role.toLowerCase());
 if(request.method==='GET'){
  const rows=await db.prepare('SELECT season,sheet_id FROM team_season_sheets WHERE team_code=? ORDER BY season DESC').bind(coach.team_code).all();
  return json({team:coach.team_name||coach.organization,teamCode:coach.team_code,canEdit,sheets:rows.results});
 }
 if(request.method!=='POST'||!canEdit||request.headers.get('Origin')!==url.origin)return json({error:'A lead coach must connect the season sheet.'},403);
 const input=await request.json(),season=String(input.season||'').trim().replace(/\s+/g,' '),match=String(input.link||'').trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{15,120})(?:[/?#].*)?$/);
 if(!match||!season||season.length>50)return json({error:'Enter the season and a Google Sheets edit link.'},400);
 const saved=await db.prepare('INSERT INTO team_season_sheets VALUES(?,?,?) ON CONFLICT(team_code,season) DO UPDATE SET sheet_id=excluded.sheet_id WHERE team_season_sheets.sheet_id=? OR team_season_sheets.sheet_id=excluded.sheet_id RETURNING sheet_id').bind(coach.team_code,season.toLowerCase(),match[1],String(input.previous||'')).first();
 return saved?json({saved:true}):json({error:'This season already has a different sheet. Reload before replacing it.'},409);
}

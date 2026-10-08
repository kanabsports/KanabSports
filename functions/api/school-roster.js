import {getCoach,ensureCoachCore,json} from '../_lib/coach-auth.js';
import {schoolSchema,schoolAudit,trustedOrigin,messagingGate} from '../_lib/school-access.js';
import {validateStudents} from '../../assets/school-roster.mjs';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unavailable.'},503);
 try{
 await ensureCoachCore(db);await schoolSchema(db);const coach=await getCoach(request,db);if(!coach)return json({error:'Sign in with your coach account.'},401);
 const team=await db.prepare('SELECT t.*,s.name school_name FROM school_teams t LEFT JOIN school_orgs s ON s.id=t.school_id WHERE team_code=?').bind(coach.team_code||'').first();
 if(!team||team.kind!=='school')return json({error:'Ask Pep to assign your team to its verified school first.'},403);
 if(request.method==='GET')return json({team,gate:await messagingGate(db,team.team_code),students:(await db.prepare('SELECT student_ref,student_name FROM school_rosters WHERE team_code=? AND revision=? ORDER BY student_name').bind(team.team_code,team.revision).all()).results});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open Kanab Sports.'},403);
 if(/assistant/i.test(coach.role))return json({error:'The head coach or coach must submit the roster.'},403);
 const raw=await request.text();if(raw.length>100000)return json({error:'Roster too large.'},413);
 let b,rows;try{b=JSON.parse(raw);rows=validateStudents(b.rows,{allowBlankRefs:true})}catch(e){return json({error:e.message||'Invalid roster.'},400)}
 const schoolYear=String(b.school_year||'');if(!/^20\d{2}-20\d{2}$/.test(schoolYear)||Number(schoolYear.slice(5))!==Number(schoolYear.slice(0,4))+1)return json({error:'Use a school year such as 2026-2027.'},400);
 const season=String(b.season||'').trim(),expires=String(b.expires||''),end=Date.parse(expires+'T00:00:00Z');
 if(b.confirmed!==true||!season||season.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(expires)||!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==expires||end<=Date.now()||end>Date.now()+366*86400000)return json({error:'Confirm school authorization to submit this roster and supply a season and expiry within one year.'},400);
 if(b.revision!==team.revision)return json({error:'The roster changed. Reload before submitting.'},409);
 for(const row of rows)if(!row.student_ref)row.student_ref='PEP-'+crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
 // A duplicate concurrent version violates the roster primary key and rolls the batch back.
 const revision=team.revision+1;
 await db.batch([db.prepare('INSERT INTO school_roster_versions SELECT team_code,CASE WHEN revision=? THEN revision+1 ELSE NULL END FROM school_teams WHERE team_code=?').bind(team.revision,team.team_code),db.prepare('UPDATE school_teams SET revision=?,approved_revision=0,active_batch=NULL,season=?,school_year=?,expires=? WHERE team_code=? AND revision=?').bind(revision,season,schoolYear,expires,team.team_code,team.revision),db.prepare("INSERT INTO school_rosters SELECT ?,?,json_extract(value,'$.student_ref'),json_extract(value,'$.student_name') FROM json_each(?)").bind(team.team_code,revision,JSON.stringify(rows)),schoolAudit(db,team.school_id,team.team_code,coach.email,'submit_roster','revision '+revision)]);
 return json({success:true,revision,message:'Roster submitted as unverified. School Pep Talk remains locked until the school approves guardian contacts.'});
 }catch{return json({error:'Roster could not be saved. Reload and try again.'},500)}
}

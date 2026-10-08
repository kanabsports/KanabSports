import {authenticate} from './admin-dashboard.js';
import {schoolSchema,schoolAudit,trustedOrigin} from '../_lib/school-access.js';
import {ensureCoachCore,json} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unavailable.'},503);
 try{
 const owner=await authenticate(request,db);if(!owner)return json({error:'Sign in to the owner admin account.'},401);
 await ensureCoachCore(db);await schoolSchema(db);
 if(request.method==='GET')return json({schools:(await db.prepare('SELECT * FROM school_orgs ORDER BY name').all()).results,staff:(await db.prepare('SELECT id,school_id,email,role,active,expires FROM school_staff ORDER BY created DESC').all()).results,teams:(await db.prepare("SELECT c.team_code,MAX(c.team_name) team_name,MAX(c.organization) organization,MAX(c.sport) sport,p.kind,p.school_id FROM coach_access_requests c LEFT JOIN school_teams p ON p.team_code=c.team_code WHERE c.status='approved' AND c.team_code IS NOT NULL GROUP BY c.team_code ORDER BY organization,team_name").all()).results});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open Kanab Sports.'},403);
 const raw=await request.text();if(raw.length>4000)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(b.action==='revoke_staff'){
  const s=await db.prepare('SELECT * FROM school_staff WHERE id=?').bind(String(b.id||'')).first();if(!s)return json({error:'Staff permission not found.'},404);
  await db.batch([db.prepare('UPDATE school_staff SET active=0 WHERE id=? OR parent_grant=?').bind(s.id,s.id),schoolAudit(db,s.school_id,null,owner.email,'revoke_staff',s.id)]);return json({success:true});
 }
 const evidence=String(b.evidence||'').trim();if(b.confirmed!==true||evidence.length<10||evidence.length>500)return json({error:'Record the authorization or city recommendation and confirm it.'},400);
 if(b.action==='create_school'){
  const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),expires=Date.parse(b.expires+'T00:00:00Z');
  if(!name||name.length>160||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||!(expires>Date.now()&&expires<=Date.now()+366*86400000))return json({error:'Provide a school name, verified principal email and permission expiry within one year.'},400);
  const id=crypto.randomUUID(),grant=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO school_orgs VALUES(?,?,?)').bind(id,name,Date.now()),db.prepare("INSERT INTO school_staff VALUES(?,?,?,'principal',1,?,NULL,?,?,?)").bind(grant,id,email,owner.email,expires,evidence,Date.now()),schoolAudit(db,id,null,owner.email,'verify_principal',grant)]);return json({success:true,id,message:'School and principal permission saved. No email was sent.'});
 }
 if(b.action==='assign_team'){
  const code=String(b.team_code||'').trim().toUpperCase(),kind=String(b.kind||'');if(!['school','rec','travel'].includes(kind))return json({error:'Choose school, rec or travel.'},400);
  const coach=await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved'").bind(code).first();if(!coach)return json({error:'Choose an active coach team. The coach must open team messaging once to create its code.'},400);
  if(await db.prepare('SELECT team_code FROM school_teams WHERE team_code=?').bind(code).first())return json({error:'This team is already assigned. Contact Pep support to change its organization safely.'},409);
  let school=null;if(kind==='school'){school=await db.prepare('SELECT id FROM school_orgs WHERE id=?').bind(String(b.school_id||'')).first();if(!school)return json({error:'Choose a verified school.'},400)}
  await db.batch([db.prepare('INSERT INTO school_teams(team_code,kind,school_id,evidence,assigned_by) VALUES(?,?,?,?,?)').bind(code,kind,school?.id||null,evidence,owner.email),schoolAudit(db,school?.id,code,owner.email,'assign_team',kind+': '+evidence)]);return json({success:true});
 }
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'School setup could not be saved.'},500)}
}

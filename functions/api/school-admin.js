import {audienceSchema} from '../_lib/pep-audiences.js';
import {eligibleSQL} from '../_lib/private-messages.js';
import {validEmail} from '../_lib/coach-auth.js';
import {authenticate} from './admin-dashboard.js';
import {schoolSchema,schoolAudit,trustedOrigin} from '../_lib/school-access.js';
import {ensureCoachCore,json} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unavailable.'},503);
 try{
 const owner=await authenticate(request,db);if(!owner)return json({error:'Sign in to the owner admin account.'},401);
 await ensureCoachCore(db);await schoolSchema(db);
 if(request.method==='GET')return json({studentPilot:env.PRIVATE_MESSAGING_ENABLED==='true'&&env.PEP_STUDENT_AUDIENCE_ENABLED==='true',schools:(await db.prepare('SELECT * FROM school_orgs ORDER BY name').all()).results,staff:(await db.prepare('SELECT id,school_id,email,role,active,expires FROM school_staff ORDER BY created DESC').all()).results,teams:(await db.prepare("SELECT c.team_code,MAX(c.team_name) team_name,MAX(c.organization) organization,MAX(c.sport) sport,p.kind,p.school_id,r.kind requested_kind FROM coach_access_requests c LEFT JOIN school_teams p ON p.team_code=c.team_code LEFT JOIN coach_team_categories r ON r.team_code=c.team_code WHERE c.status='approved' AND c.team_code IS NOT NULL GROUP BY c.team_code ORDER BY organization,team_name").all()).results});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open Kanab Sports.'},403);
 const raw=await request.text();if(raw.length>4000)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(b.action==='revoke_staff'){
  const s=await db.prepare('SELECT * FROM school_staff WHERE id=?').bind(String(b.id||'')).first();if(!s)return json({error:'Staff permission not found.'},404);
  await db.batch([db.prepare('UPDATE school_staff SET active=0 WHERE id=? OR parent_grant=?').bind(s.id,s.id),schoolAudit(db,s.school_id,null,owner.email,'revoke_staff',s.id)]);return json({success:true});
 }
 const evidence=String(b.evidence||'').trim();if(b.confirmed!==true||evidence.length<10||evidence.length>500)return json({error:'Record the authorization or city recommendation and confirm it.'},400);
 if(b.action==='enroll_athlete'||b.action==='withdraw_athlete'){
  if(env.PRIVATE_MESSAGING_ENABLED!=='true'||env.PEP_STUDENT_AUDIENCE_ENABLED!=='true')return json({error:'Athlete pilot is disabled.'},403);
  await audienceSchema(db);
  const code=String(b.team_code||''),guardian=String(b.guardian||'').trim().toLowerCase(),ref=String(b.student_ref||'').trim();
  const membership=await db.prepare("SELECT g.id FROM guardian_memberships g WHERE g.team_code=? AND g.email=? AND g.student_ref=? AND g.status='approved' AND g.expires>? ORDER BY g.created DESC LIMIT 1").bind(code,guardian,ref,Date.now()).first();
  if(!membership)return json({error:'Current approved guardian and roster reference required.'},403);
  if(b.action==='withdraw_athlete'){
    const result=await db.prepare("UPDATE pep_student_enrollments SET active=0 WHERE membership_id=? AND active=1 RETURNING id").bind(membership.id).first();
    return result?json({success:true}):json({error:'No active enrollment found.'},404);
  }
  const email=String(b.athlete_email||'').trim().toLowerCase(),expires=Date.parse(b.expires+'T00:00:00Z'),now=Date.now();
  if(b.verified_teen!==true||!validEmail(email)||email.length>254||email===guardian||!(expires>now&&expires<=now+366*86400000))return json({error:'Verify a distinct athlete email, age 13–17, guardian consent and an expiry within one year.'},400);
  await db.prepare('UPDATE pep_student_enrollments SET active=0 WHERE membership_id=? AND expires<=?').bind(membership.id,now).run();
  const row=await db.prepare(`INSERT OR IGNORE INTO pep_student_enrollments SELECT ?,g.id,t.organization_id,?,?,1,MIN(?,g.expires),1
    FROM guardian_memberships g JOIN (`+eligibleSQL+`) t ON t.team_code=g.team_code
    WHERE g.id=? AND g.status='approved' AND g.expires>? LIMIT 1 RETURNING id`).bind(crypto.randomUUID(),email,evidence,expires,membership.id,now).first();
  return row?json({success:true}):json({error:'Team is ineligible or already has an enrollment. Withdraw the prior enrollment before replacing it.'},409);
 }
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

import {schoolSchema,schoolSession,schoolRoles,schoolAudit,trustedOrigin,messagingGate,reusableContacts} from '../_lib/school-access.js';
import {accessSchema} from '../_lib/parent-access.js';
import {json,sha256} from '../_lib/coach-auth.js';
import {validateRosterRows} from '../../assets/guardian-import.mjs';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unavailable.'},503);
 try{
 await schoolSchema(db);await accessSchema(db);
 const session=await schoolSession(request,db);if(!session)return json({error:'Sign in with your authorized school email.'},401);
 const url=new URL(request.url),schoolId=url.searchParams.get('school_id');
 const roles=await schoolRoles(db,session.email,schoolId);if(!schoolId||!roles.length)return json({error:'You do not have permission for this school.'},403);
 const principal=roles.find(r=>r.role==='principal');
 if(request.method==='GET'){
  const teams=(await db.prepare(`SELECT t.*, (SELECT c.team_name FROM coach_access_requests c WHERE c.team_code=t.team_code AND c.status='approved' LIMIT 1) team_name FROM school_teams t WHERE school_id=? AND kind='school'`).bind(schoolId).all()).results||[];
  const code=url.searchParams.get('team_code'),selected=teams.find(t=>t.team_code===code);if(code&&!selected)return json({error:'Team not found in this school.'},404);
  const students=selected?(await db.prepare('SELECT student_ref,student_name FROM school_rosters WHERE team_code=? AND revision=? ORDER BY student_name').bind(code,selected.revision).all()).results:[];
  const contacts=selected?(await db.prepare('SELECT m.id,m.email,m.student_ref,m.season,m.status,m.expires,m.approved_by FROM guardian_memberships m JOIN school_approved_memberships a ON a.membership_id=m.id WHERE a.batch_id=? AND m.team_code=?').bind(selected.active_batch||'',code).all()).results:[];
  const staff=principal?(await db.prepare('SELECT id,email,role,active,expires,parent_grant FROM school_staff WHERE school_id=? ORDER BY created DESC').bind(schoolId).all()).results:[];
  const audit=(await db.prepare('SELECT actor,action,detail,created,team_code FROM school_audit WHERE school_id=? ORDER BY created DESC LIMIT 100').bind(schoolId).all()).results;
  return json({school:roles[0].school_name,principal:!!principal,teams,selected,students,contacts,staff,audit,reusable:selected?await reusableContacts(db,selected):[],gate:selected?await messagingGate(db,code):null});
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open Kanab Sports.'},403);
 const raw=await request.text();if(raw.length>100000)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(b.action==='revoke_staff'){
  if(!principal)return json({error:'Only the principal can manage delegates.'},403);
  const found=await db.prepare("SELECT id FROM school_staff WHERE id=? AND school_id=? AND role='contacts'").bind(String(b.id||''),schoolId).first();if(!found)return json({error:'Delegate not found.'},404);
  await db.batch([db.prepare('UPDATE school_staff SET active=0 WHERE id=? AND school_id=?').bind(found.id,schoolId),schoolAudit(db,schoolId,null,session.email,'revoke_delegate',found.id)]);return json({success:true});
 }
 if(b.action==='delegate'){
  if(!principal)return json({error:'Only the principal can grant contact permissions.'},403);
  const email=String(b.email||'').trim().toLowerCase(),evidence=String(b.evidence||'').trim(),expires=Date.parse(b.expires+'T00:00:00Z');
  if(b.confirmed!==true||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||evidence.length<10||evidence.length>500||!Number.isFinite(expires)||expires<=Date.now()||expires>principal.expires)return json({error:'Confirm the employee, record the authorization and choose an expiry no later than your own permission.'},400);
  if((await schoolRoles(db,email,schoolId)).length)return json({error:'This employee already has active school permissions.'},409);
  const id=crypto.randomUUID();await db.batch([db.prepare("INSERT INTO school_staff VALUES(?,?,?,'contacts',1,?,?,?,?,?)").bind(id,schoolId,email,session.email,principal.id,expires,evidence,Date.now()),schoolAudit(db,schoolId,null,session.email,'delegate_contacts',id)]);return json({success:true,message:'Employee authorized to upload and approve this school’s contacts. No email was sent. They can sign in at the School Portal.'});
 }
 const code=String(b.team_code||'').trim().toUpperCase(),team=await db.prepare("SELECT * FROM school_teams WHERE team_code=? AND school_id=? AND kind='school'").bind(code,schoolId).first();if(!team)return json({error:'Team not found in your school.'},404);
 if(b.action==='pause'){
  await db.batch([db.prepare('UPDATE school_teams SET approved_revision=0,active_batch=NULL WHERE team_code=? AND school_id=?').bind(code,schoolId),schoolAudit(db,schoolId,code,session.email,'pause_messaging','School paused team access')]);return json({success:true});
 }
 if(b.action==='revoke_contact'){
  const m=await db.prepare('SELECT m.id FROM guardian_memberships m JOIN school_approved_memberships a ON a.membership_id=m.id WHERE m.id=? AND m.team_code=? AND a.batch_id=?').bind(String(b.id||''),code,team.active_batch||'').first();if(!m)return json({error:'Contact not found.'},404);
  await db.batch([db.prepare("UPDATE guardian_memberships SET status='revoked' WHERE id=?").bind(m.id),db.prepare('INSERT INTO guardian_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),m.id,session.email,'school_revoke',Date.now()),schoolAudit(db,schoolId,code,session.email,'revoke_contact',m.id)]);return json({success:true});
 }
 if(b.action!=='approve_contacts')return json({error:'Unknown action.'},400);
 let rows;try{rows=validateRosterRows(b.rows)}catch(e){return json({error:e.message},400)}
 const evidence=String(b.evidence||'').trim();if(b.confirmed!==true||evidence.length<10||evidence.length>500)return json({error:'Confirm school-authorized guardian relationships and record the approval reference.'},400);
 if(team.revision<1||b.revision!==team.revision)return json({error:'The coach roster changed or is missing. Reload and download the current form.'},409);
 const students=(await db.prepare('SELECT student_ref FROM school_rosters WHERE team_code=? AND revision=?').bind(code,team.revision).all()).results||[],refs=new Set(students.map(s=>s.student_ref));
 if(rows.some(r=>r.team_code!==code||r.season!==team.season||r.expires!==team.expires||!refs.has(r.student_ref)))return json({error:'Every contact must match the current roster’s student reference, team code, season and expiry. Nothing was approved.'},400);
 const eligible=await reusableContacts(db,team);let reused=rows.map(r=>eligible.find(x=>x.email===r.email&&x.student_ref===r.student_ref)).filter(Boolean);
 if(b.reuse===true){
  if(team.active_batch)return json({error:'Bulk reuse is for a roster awaiting approval. Pause the team first to replace an approved contact list.'},409);
  for(const r of rows){const match=eligible.find(x=>x.email===r.email&&x.student_ref===r.student_ref);if(!match)return json({error:'A selected contact is no longer eligible for reuse. Reload and review again.'},409);}
 }
 const optouts=(await db.prepare('SELECT email,student_ref FROM school_parent_optouts WHERE school_id=? AND school_year=? AND team_code=?').bind(schoolId,team.school_year,code).all()).results||[];
 if(rows.some(r=>optouts.some(o=>o.email===r.email&&o.student_ref===r.student_ref)))return json({error:'A parent opted out for this student and sport. Do not override their preference by importing again.'},409);
 const rosterNames=new Map((await db.prepare('SELECT student_ref,student_name FROM school_rosters WHERE team_code=? AND revision=?').bind(code,team.revision).all()).results.map(r=>[r.student_ref,r.student_name]));
 const sport=(await db.prepare("SELECT sport FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(code).first())?.sport||'this sport';
 await db.prepare('CREATE TABLE IF NOT EXISTS parent_family (email TEXT NOT NULL,entry_id TEXT NOT NULL,team_code TEXT NOT NULL,child_name TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(email,entry_id))').run();
 const batch=crypto.randomUUID(),now=Date.now();
 // The first statement is a revision guard. All writes depend on that approval ID.
 const records=[];for(const r of rows){const prior=reused.find(x=>x.email===r.email&&x.student_ref===r.student_ref);records.push({...r,id:crypto.randomUUID(),audit:crypto.randomUUID(),notice:crypto.randomUUID(),student_name:rosterNames.get(r.student_ref),old_sport:prior?.old_sport||null,entry_id:prior?'school-'+await sha256(JSON.stringify([schoolId,code,r.student_ref])):null})}
 const payload=JSON.stringify(records),exists='EXISTS(SELECT 1 FROM school_approvals WHERE id=?)';
 const ops=[db.prepare('INSERT INTO school_approvals SELECT ?,team_code,revision,?,?,? FROM school_teams WHERE team_code=? AND school_id=? AND revision=? AND active_batch IS ?').bind(batch,session.email,evidence,now,code,schoolId,team.revision,team.active_batch),
 db.prepare(`INSERT INTO guardian_memberships SELECT json_extract(value,'$.id'),json_extract(value,'$.email'),?,json_extract(value,'$.student_ref'),?,?,'approved',?,?,? FROM json_each(?) WHERE ${exists}`).bind(code,team.season,Date.parse(team.expires+'T00:00:00Z'),session.email,evidence,now,payload,batch),
 db.prepare(`INSERT INTO school_approved_memberships SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE ${exists}`).bind(batch,payload,batch),
 db.prepare(`INSERT INTO guardian_access_audit SELECT json_extract(value,'$.audit'),json_extract(value,'$.id'),?,'school_approve',? FROM json_each(?) WHERE ${exists}`).bind(session.email,now,payload,batch),
 db.prepare(`INSERT INTO school_verified_contacts SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.student_ref'),json_extract(value,'$.student_name'),? FROM json_each(?) WHERE ${exists}`).bind(schoolId,team.school_year,sport,payload,batch),
 db.prepare(`INSERT INTO school_parent_notices SELECT json_extract(value,'$.notice'),json_extract(value,'$.email'),?,?,?,json_extract(value,'$.student_ref'),json_extract(value,'$.student_name'),json_extract(value,'$.old_sport'),?,'new',? FROM json_each(?) WHERE json_extract(value,'$.old_sport') IS NOT NULL AND ${exists}`).bind(schoolId,team.school_year,code,sport,now,payload,batch),
 db.prepare(`INSERT OR IGNORE INTO parent_family SELECT json_extract(value,'$.email'),json_extract(value,'$.entry_id'),?,json_extract(value,'$.student_name'),? FROM json_each(?) WHERE json_extract(value,'$.entry_id') IS NOT NULL AND ${exists}`).bind(code,now,payload,batch)];
 ops.push(db.prepare('UPDATE school_teams SET approved_revision=revision,active_batch=? WHERE team_code=? AND school_id=? AND revision=? AND EXISTS(SELECT 1 FROM school_approvals WHERE id=?)').bind(batch,code,schoolId,team.revision,batch),db.prepare("INSERT INTO school_audit SELECT ?,?,?,?,'approve_contacts',?,? WHERE EXISTS(SELECT 1 FROM school_approvals WHERE id=?)").bind(crypto.randomUUID(),schoolId,code,session.email,'revision '+team.revision+'; '+rows.length+' contact rows; batch '+batch,now,batch));
 await db.batch(ops);
 if(!await db.prepare('SELECT id FROM school_approvals WHERE id=?').bind(batch).first())return json({error:'Roster changed during approval. Reload and review again.'},409);
 return json({success:true,message:'School contacts approved. Pep Talk is enabled for this roster. This approved list replaces the previous recipient list. '+(reused.length?' Parents have an in-app notice with an opt-out for this sport.':' No invitations were sent.')});
 }catch{return json({error:'School action could not complete. Reload before retrying.'},500)}
}

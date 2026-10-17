import {accessSchema,hasMembership} from './parent-access.js';
// Discover only teams authorized for this verified account; never infer custody from a code.
export async function approvedTeams(db,email){
 await accessSchema(db);
 const rows=(await db.prepare("SELECT DISTINCT team_code FROM guardian_memberships WHERE email=? AND status='approved' AND expires>? LIMIT 100").bind(email,Date.now()).all()).results||[];
 const codes=[];for(const row of rows){if(await hasMembership(db,email,row.team_code)&&await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(row.team_code).first())codes.push(row.team_code)}return codes;
}
export async function connectApproved(db,email){
 const codes=await approvedTeams(db,email),existing=(await db.prepare('SELECT team_code FROM parent_family WHERE email=?').bind(email).all()).results||[],seen=new Set(existing.map(x=>x.team_code));
 const missing=codes.filter(code=>!seen.has(code));if(existing.length+missing.length>20)throw Error('Your family already has too many saved teams. Remove an unused team before connecting more.');
 if(missing.length)await db.batch(missing.map(code=>db.prepare("INSERT OR IGNORE INTO parent_family(email,entry_id,team_code,child_name,created) SELECT ?,?,?,'',? WHERE NOT EXISTS(SELECT 1 FROM parent_family WHERE email=? AND team_code=?)").bind(email,'approved-'+code,code,Date.now(),email,code)));
 return missing.length;
}

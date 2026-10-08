import {sha256} from './coach-auth.js';
const initialized=new WeakSet();
export async function schoolSchema(db){
 if(initialized.has(db))return;
 for(const sql of [
 `CREATE TABLE IF NOT EXISTS school_orgs(id TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_staff(id TEXT PRIMARY KEY,school_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,granted_by TEXT NOT NULL,parent_grant TEXT,expires INTEGER NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS school_staff_lookup ON school_staff(email,school_id,active)`,
 `CREATE TABLE IF NOT EXISTS school_sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_login_codes(email TEXT PRIMARY KEY,hash TEXT NOT NULL,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_teams(team_code TEXT PRIMARY KEY,kind TEXT NOT NULL,school_id TEXT,revision INTEGER NOT NULL DEFAULT 0,approved_revision INTEGER NOT NULL DEFAULT 0,active_batch TEXT,season TEXT,school_year TEXT,expires TEXT,evidence TEXT NOT NULL,assigned_by TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_roster_versions(team_code TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(team_code,revision))`,
 `CREATE TABLE IF NOT EXISTS school_rosters(team_code TEXT NOT NULL,revision INTEGER NOT NULL,student_ref TEXT NOT NULL,student_name TEXT NOT NULL,PRIMARY KEY(team_code,revision,student_ref))`,
 `CREATE TABLE IF NOT EXISTS school_approvals(id TEXT PRIMARY KEY,team_code TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_approved_memberships(membership_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_verified_contacts(membership_id TEXT PRIMARY KEY,school_id TEXT NOT NULL,school_year TEXT NOT NULL,student_ref TEXT NOT NULL,student_name TEXT NOT NULL,sport TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_parent_notices(id TEXT PRIMARY KEY,email TEXT NOT NULL,school_id TEXT NOT NULL,school_year TEXT NOT NULL,team_code TEXT NOT NULL,student_ref TEXT NOT NULL,student_name TEXT NOT NULL,old_sport TEXT NOT NULL,new_sport TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS school_parent_optouts(email TEXT NOT NULL,school_id TEXT NOT NULL,school_year TEXT NOT NULL,team_code TEXT NOT NULL,student_ref TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(email,school_id,school_year,team_code,student_ref))`,
 `CREATE TABLE IF NOT EXISTS school_audit(id TEXT PRIMARY KEY,school_id TEXT,team_code TEXT,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL)`
  ])await db.prepare(sql).run();
 initialized.add(db);
}
export async function schoolSession(request,db){
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-pep_school=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!token)return null;
 return db.prepare('SELECT email FROM school_sessions WHERE hash=? AND expires>?').bind(await sha256(token),Date.now()).first();
}
export async function schoolRoles(db,email,schoolId){
 if(!email)return [];
 const now=Date.now();
 return (await db.prepare(`SELECT s.*,o.name AS school_name FROM school_staff s JOIN school_orgs o ON o.id=s.school_id WHERE s.email=? AND s.active=1 AND s.expires>? AND (? IS NULL OR s.school_id=?) AND (s.role='principal' OR EXISTS(SELECT 1 FROM school_staff p WHERE p.id=s.parent_grant AND p.school_id=s.school_id AND p.role='principal' AND p.active=1 AND p.expires>?))`).bind(email,now,schoolId||null,schoolId||null,now).all()).results||[];
}
export function schoolAudit(db,school,team,actor,action,detail){return db.prepare('INSERT INTO school_audit VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),school||null,team||null,actor,action,detail,Date.now())}
export async function teamPolicy(db,code){await schoolSchema(db);return db.prepare('SELECT * FROM school_teams WHERE team_code=?').bind(code).first()}
export async function messagingGate(db,code){
 const policy=await teamPolicy(db,code);
 if(!policy)return {allowed:false,kind:'unassigned',reason:'Pep must confirm this team as school, rec or travel before messaging is enabled.'};
 if(policy.kind!=='school')return {allowed:true,kind:policy.kind};
 const ready=policy.revision>0&&policy.approved_revision===policy.revision&&policy.active_batch&&Date.parse(policy.expires+'T00:00:00Z')>Date.now();
 if(!ready)return {allowed:false,kind:'school',reason:'School Pep Talk is locked until an authorized school employee uploads and approves guardian contacts for the current roster.'};
 const recipient=await db.prepare(`SELECT m.id FROM guardian_memberships m JOIN school_approved_memberships a ON a.membership_id=m.id WHERE a.batch_id=? AND m.team_code=? AND m.status='approved' AND m.expires>? AND NOT EXISTS(SELECT 1 FROM school_parent_optouts o WHERE o.email=m.email AND o.student_ref=m.student_ref AND o.team_code=m.team_code AND o.school_id=? AND o.school_year=?) LIMIT 1`).bind(policy.active_batch,code,Date.now(),policy.school_id,policy.school_year).first();
 return {allowed:!!recipient,kind:'school',reason:recipient?'':'School Pep Talk is locked because there are no active school-approved guardian contacts.'};
}
export const trustedOrigin=r=>r.headers.get('Origin')==='https://kanabsports.com'&&new URL(r.url).origin==='https://kanabsports.com';

export async function reusableContacts(db,team){
 if(!team.school_year||!team.revision)return [];
 const rows=(await db.prepare(`SELECT m.email,v.student_ref,v.student_name,v.sport AS old_sport,m.id AS source_id
 FROM school_verified_contacts v JOIN guardian_memberships m ON m.id=v.membership_id
 JOIN school_approved_memberships a ON a.membership_id=m.id
 JOIN school_teams source ON source.team_code=m.team_code AND source.active_batch=a.batch_id
 JOIN school_rosters current ON current.team_code=? AND current.revision=? AND current.student_ref=v.student_ref AND current.student_name=v.student_name
 WHERE v.school_id=? AND v.school_year=? AND m.team_code!=? AND m.status='approved'
 AND NOT EXISTS(SELECT 1 FROM school_parent_optouts o WHERE o.email=m.email AND o.school_id=v.school_id AND o.school_year=v.school_year AND o.student_ref=v.student_ref)
 AND NOT EXISTS(SELECT 1 FROM guardian_memberships revoked JOIN school_verified_contacts rv ON rv.membership_id=revoked.id WHERE revoked.status='revoked' AND revoked.email=m.email AND rv.school_id=v.school_id AND rv.school_year=v.school_year AND rv.student_ref=v.student_ref)
 ORDER BY m.created DESC`).bind(team.team_code,team.revision,team.school_id,team.school_year,team.team_code).all()).results||[];
 const seen=new Set();return rows.filter(r=>{const key=JSON.stringify([r.email,r.student_ref]);if(seen.has(key))return false;seen.add(key);return true}).map(r=>({...r,team_code:team.team_code,season:team.season,expires:team.expires}));
}

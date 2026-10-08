export async function accessSchema(db){
 for(const sql of [
 'CREATE TABLE IF NOT EXISTS parent_sessions (hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS guardian_memberships (id TEXT PRIMARY KEY,email TEXT NOT NULL,team_code TEXT NOT NULL,student_ref TEXT NOT NULL,season TEXT NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,approved_by TEXT NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS guardian_memberships_access ON guardian_memberships(email,team_code,status,expires)',
 'CREATE TABLE IF NOT EXISTS guardian_access_audit (id TEXT PRIMARY KEY,membership_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS parent_access_requests (email TEXT NOT NULL,team_code TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(email,team_code))'
 ])await db.prepare(sql).run();
}
export async function parentSession(request,db){
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-ks_parent=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 return db.prepare('SELECT email FROM parent_sessions WHERE hash=? AND expires>?').bind(hash,Date.now()).first();
}
export async function hasMembership(db,email,code){
 if(!email)return false;
 return !!await db.prepare("SELECT id FROM guardian_memberships WHERE email=? AND team_code=? AND status='approved' AND expires>? LIMIT 1").bind(email,code,Date.now()).first();
}

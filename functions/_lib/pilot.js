// Identity allowlist; email addresses are not published in source.
export const IDENTITIES={"29f9566f0e8a51d2ed8626f68be76b9534f42463ac22ba14391c6bdf7e69eb3c": {"id": "britt", "name": "Britt Roth", "role": "Coach"}, "d84bcb632e50aed9203d8e5ddfc1f8e4748bd02e845333902821e490ece8481a": {"id": "jodi", "name": "Jodi Palmer", "role": "Assistant Coach"}, "abdc42c283c58362c926a4796b41d3e9c4654c7182cb4c0a06c999a32f38681b": {"id": "amber", "name": "Amber Hooper", "role": "Head Coach"}};
export const ORIGIN='https://kanabsports.com';
export const COOKIE='__Host-ks_team_d';
export const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
export const identity=async email=>IDENTITIES[await hash(email)];
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function schema(db){for(const sql of [
 'CREATE TABLE IF NOT EXISTS team_d_challenges (id TEXT PRIMARY KEY,email TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS team_d_sessions (hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_members (email TEXT PRIMARY KEY,joined INTEGER NOT NULL,last_seen INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_approvals (email TEXT PRIMARY KEY,status TEXT NOT NULL,reviewed_by TEXT,reviewed_at INTEGER)',
 'CREATE TABLE IF NOT EXISTS team_d_notifications (id TEXT PRIMARY KEY,coach_name TEXT NOT NULL,created INTEGER NOT NULL,sent_at INTEGER)',
 'CREATE TABLE IF NOT EXISTS team_d_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_announcements (id TEXT PRIMARY KEY,author TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)'
 ])await db.prepare(sql).run();}
export async function session(request,db){
 if(!db)return null;
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-ks_team_d=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;
 try{const row=await db.prepare('SELECT email FROM team_d_sessions WHERE hash=? AND expires>?').bind(await hash(token),Date.now()).first();if(!row)return null;const member=await identity(row.email);if(!member)return null;const approval=await db.prepare('SELECT status FROM team_d_approvals WHERE email=?').bind(row.email).first();return {...member,email:row.email,status:member.id==='amber'?'approved':approval?.status||'pending'};}catch{return null;}
}
export async function authorized(request,db){const m=await session(request,db);return m?.status==='approved'?m:null;}
export function sameOrigin(request){return request.headers.get('Origin')===ORIGIN&&new URL(request.url).origin===ORIGIN;}
export async function limit(db,key,max){const r=await db.prepare('INSERT INTO team_d_limits (key,count) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key).first();return r.count<=max;}
export async function seedSignupRecords(db){
 const rows=(await db.prepare('SELECT email,joined FROM team_d_members').all()).results||[];
 for(const row of rows){const m=await identity(row.email);if(!m||m.id==='amber')continue;
 await db.prepare("INSERT OR IGNORE INTO team_d_approvals(email,status) VALUES (?,'pending')").bind(row.email).run();
 await db.prepare('INSERT OR IGNORE INTO team_d_notifications(id,coach_name,created) VALUES (?,?,?)').bind(await hash(row.email),m.name,row.joined).run();
 }
}
export async function notifyHead(env){
 try{
 const db=env.SPORTS_DB,recipient=await db.prepare("SELECT value FROM team_d_settings WHERE key='head_email'").first();
 if(!recipient||!(await identity(recipient.value))||!env.RESEND_API_KEY)return;
 if((await identity(recipient.value)).id!=='amber')return;
 const pending=(await db.prepare('SELECT id,coach_name FROM team_d_notifications WHERE sent_at IS NULL ORDER BY created LIMIT 10').all()).results||[];
 for(const n of pending){const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'team-d-signup-'+n.id},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[recipient.value],reply_to:'howdy@kanabsports.com',subject:n.coach_name+' joined Team D · Kanab Sports',text:n.coach_name+' has verified their email for Team D. Open your head coach portal to see their status and review access:\n\nhttps://kanabsports.com/amber/\n\nKanab Sports · powered by pep'})});if(r.ok)await db.prepare('UPDATE team_d_notifications SET sent_at=? WHERE id=?').bind(Date.now(),n.id).run();}
 }catch{/* The durable queue stays pending; an authenticated refresh retries delivery. */}
}

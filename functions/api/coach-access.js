const COOKIE='ks_coach';
export async function onRequestPost({request,env}){
  if(!env.SPORTS_DB)return json({valid:false,error:'Coach access is not configured.'},503);
  try{
    await ensureSchema(env.SPORTS_DB);
    const body=await request.json(),code=String(body?.code||body?.credential||'').trim().toUpperCase();
    if(!code)return json({valid:false});
    const hash=await sha256Code(code),coach=await env.SPORTS_DB.prepare(`SELECT id,name,email,phone,sport,organization FROM coach_access_requests WHERE status='approved' AND access_code_hash=? LIMIT 1`).bind(hash).first();
    if(!coach)return json({valid:false});
    return json({valid:true,coach:profile(coach)});
  }catch(error){console.error('coach access error',error);return json({valid:false,error:'Could not verify coach access.'},500)}
}
export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({valid:false},503);
  try{await ensureSchema(env.SPORTS_DB);const token=cookie(request,COOKIE);if(!token)return json({valid:false});const hash=await sha256Exact(token),coach=await env.SPORTS_DB.prepare(`SELECT a.id,a.name,a.email,a.phone,a.sport,a.organization FROM coach_sessions s JOIN coach_access_requests a ON a.id=s.coach_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='approved' LIMIT 1`).bind(hash).first();return coach?json({valid:true,coach:profile(coach),session:true}):json({valid:false})}catch(error){console.error('coach session error',error);return json({valid:false},500)}}
async function ensureSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS coach_access_requests (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,organization TEXT NOT NULL,sport TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,team_url TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();try{await db.prepare(`ALTER TABLE coach_access_requests ADD COLUMN access_code_hash TEXT`).run()}catch{}await db.prepare(`CREATE TABLE IF NOT EXISTS coach_sessions (id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
function profile(c){return{name:c.name||'',email:c.email||'',phone:c.phone||'',sport:c.sport||'',team:c.organization||''}}
async function sha256Code(v){return sha256Exact(String(v).trim().toUpperCase())}async function sha256Exact(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v)));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}function cookie(r,n){const m=(r.headers.get('Cookie')||'').match(new RegExp('(?:^|;\\s*)'+n+'=([^;]+)'));return m?decodeURIComponent(m[1]):''}function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
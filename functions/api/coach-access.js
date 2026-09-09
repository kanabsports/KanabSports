export async function onRequestPost({request,env}){
  if(!env.SPORTS_DB)return json({valid:false,error:'Coach access is not configured.'},503);
  try{
    await ensureSchema(env.SPORTS_DB);
    const body=await request.json(),code=String(body?.code||body?.credential||'').trim().toUpperCase();
    if(!code)return json({valid:false});
    const hash=await sha256(code),coach=await env.SPORTS_DB.prepare(`SELECT name,email,phone,sport,organization FROM coach_access_requests WHERE status='approved' AND access_code_hash=? LIMIT 1`).bind(hash).first();
    if(!coach)return json({valid:false});
    return json({valid:true,coach:{name:coach.name||'',email:coach.email||'',phone:coach.phone||'',sport:coach.sport||'',team:coach.organization||''}});
  }catch(error){console.error('coach access error',error);return json({valid:false,error:'Could not verify coach access.'},500)}
}
export function onRequestGet(){return json({valid:false},405)}
async function ensureSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS coach_access_requests (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,organization TEXT NOT NULL,sport TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,team_url TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();try{await db.prepare(`ALTER TABLE coach_access_requests ADD COLUMN access_code_hash TEXT`).run()}catch{}}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v).trim().toUpperCase()));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
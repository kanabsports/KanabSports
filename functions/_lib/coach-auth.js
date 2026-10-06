const COOKIE='ks_coach';

export async function getCoach(request,db){
  if(!db)return null;
  const token=cookie(request,COOKIE);
  if(!token)return null;
  const hash=await sha256(token);
  return await db.prepare(`
    SELECT a.id,a.name,a.email,a.phone,a.sport,a.organization,a.role,a.status
    FROM coach_sessions s
    JOIN coach_access_requests a ON a.id=s.coach_id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='approved'
    LIMIT 1
  `).bind(hash).first();
}

export function canManageAssistants(coach){
  return !!coach && !/assistant/i.test(String(coach.role||''));
}

export function sameOrigin(request){
  const o=request.headers.get('Origin');
  if(!o)return true;
  try{return new URL(o).origin===new URL(request.url).origin}catch{return false}
}

export function normalizePhone(v){
  const raw=String(v||'').trim();
  const digits=raw.replace(/\D/g,'');
  if(digits.length===10)return '+1'+digits;
  if(digits.length===11&&digits.startsWith('1'))return '+'+digits;
  if(/^\+1\d{10}$/.test(raw))return raw;
  return '';
}

export async function ensureCoachCore(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_access_requests (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,organization TEXT NOT NULL,
    sport TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,team_url TEXT,message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,
    reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for(const q of [
    `ALTER TABLE coach_access_requests ADD COLUMN access_code_hash TEXT`,
    `ALTER TABLE coach_access_requests ADD COLUMN password_hash TEXT`,
    `ALTER TABLE coach_access_requests ADD COLUMN password_salt TEXT`,
    `ALTER TABLE coach_access_requests ADD COLUMN password_iterations INTEGER`
  ])try{await db.prepare(q).run()}catch{}
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_sessions (
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function sha256(v){
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v)));
  return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('');
}
export function randomToken(bytes=32){
  const b=crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
}
export function clean(v,max=500){
  return String(v||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max);
}
export function validEmail(v){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim());
}
export function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function cookie(r,n){
  const m=(r.headers.get('Cookie')||'').match(new RegExp('(?:^|;\\s*)'+n+'=([^;]+)'));
  return m?decodeURIComponent(m[1]):'';
}
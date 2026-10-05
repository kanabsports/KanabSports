const COOKIE='__Host-ks_parent';
const ORIGIN='https://kanabsports.com';
const encode=new TextEncoder();
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function pinHash(pin,salt){const key=await crypto.subtle.importKey('raw',encode.encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encode.encode(salt),iterations:100000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('')}
function equalHash(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function signedResponse(token){const r=json({success:true});r.headers.set('Set-Cookie',`${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);return r}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function schema(db){for(const sql of[
 'CREATE TABLE IF NOT EXISTS parent_challenges (id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS parent_sessions (hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS parent_accounts (email TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS parent_family (email TEXT NOT NULL,entry_id TEXT NOT NULL,team_code TEXT NOT NULL,child_name TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(email,entry_id))',
 'CREATE TABLE IF NOT EXISTS parent_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS parent_pins (email TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL,updated INTEGER NOT NULL)'
])await db.prepare(sql).run()}
async function limit(db,key,max){const r=await db.prepare('INSERT INTO parent_limits (key,count) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key).first();return r.count<=max}
async function session(request,db){const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-ks_parent=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;return await db.prepare('SELECT email FROM parent_sessions WHERE hash=? AND expires>?').bind(await hash(token),Date.now()).first()}
function cleanEmail(v){const email=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254?email:''}
function cleanName(v,max=80){return String(v||'').trim().replace(/\s+/g,' ').slice(0,max)}
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'Parent accounts are not ready. Please try again later.'},503);
 const db=env.SPORTS_DB;
 try{
  await schema(db);
  if(request.method==='GET'){
   const ses=await session(request,db);if(!ses)return json({signedIn:false});
   const account=await db.prepare('SELECT email,name,created,last_seen FROM parent_accounts WHERE email=?').bind(ses.email).first();
   const family=await db.prepare('SELECT entry_id,team_code,child_name,created FROM parent_family WHERE email=? ORDER BY created').bind(ses.email).all();
   if(account)await db.prepare('UPDATE parent_accounts SET last_seen=? WHERE email=?').bind(Date.now(),ses.email).run();
   return json({signedIn:true,account,family:family.results||[]});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==ORIGIN||new URL(request.url).origin!==ORIGIN)return json({error:'Open the Parent Portal at kanabsports.com.'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
  const raw=await request.text();if(raw.length>12000)return json({error:'Request too large.'},413);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
  if(body.action==='login_pin'){
   const email=cleanEmail(body.email),pin=String(body.pin||'');
   if(!email||!/^\d{6}$/.test(pin))return json({error:'Enter your email address and 6-digit PIN.'},400);
   const now=Date.now(),emailKey=await hash(email),ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown');
   if(!await limit(db,`pin-ip:${ip}:${Math.floor(now/3600000)}`,30)||!await limit(db,`pin-email:${emailKey}:${Math.floor(now/900000)}`,5)||!await limit(db,`pin-day:${emailKey}:${Math.floor(now/86400000)}`,20))return json({error:'Too many PIN attempts. Try later, or verify your email to reset your PIN.'},429);
   const row=await db.prepare('SELECT salt,hash FROM parent_pins WHERE email=?').bind(email).first();
   const candidate=await pinHash(pin,row?.salt||'kanab-parent-missing-account-salt');
   if(!row||!equalHash(candidate,row.hash))return json({error:'Email or PIN not recognized. Try again, or choose Set / reset PIN to verify your email.'},403);
   const token=random();
   await db.batch([db.prepare('INSERT INTO parent_sessions (hash,email,expires) VALUES (?,?,?)').bind(await hash(token),email,now+30*86400000),db.prepare('UPDATE parent_accounts SET last_seen=? WHERE email=?').bind(now,email),db.prepare('DELETE FROM parent_sessions WHERE expires<?').bind(now)]);
   return signedResponse(token);
  }
  if(body.action==='request_code'){
   if(!env.RESEND_API_KEY)return json({error:'Email verification is temporarily unavailable. If you already have a PIN, use Sign In.'},503);
   const email=cleanEmail(body.email),name=cleanName(body.name);
   if(!email)return json({error:'Enter a valid email address.'},400);
   if(!name)return json({error:'Enter your name.'},400);
   const hour=Math.floor(Date.now()/3600000),ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown');
   if(!await limit(db,`parent-ip:${ip}:${hour}`,20)||!await limit(db,`parent-email:${email}:${hour}`,5))return json({error:'Too many code requests. Please try again in an hour.'},429);
   const id=random(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
   await db.prepare('INSERT INTO parent_challenges (id,email,name,hash,expires) VALUES (?,?,?,?,?)').bind(id,email,name,await hash(id+':'+code),Date.now()+600000).run();
   let sent;try{sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[email],subject:'Your Kanab Sports parent code',text:`Hi ${name},\n\nYour Kanab Sports parent code is: ${code}\n\nEnter it at https://kanabsports.com/family/ to verify your email and set or reset your 6-digit PIN. The email code expires in 10 minutes and can only be used once.\n\nNext time, sign in with your email and the PIN you choose. Parent accounts are free.\n\nIf you did not request this code, ignore this email.\n\nKanab Sports`})})}catch{}
   if(!sent?.ok){await db.prepare('DELETE FROM parent_challenges WHERE id=?').bind(id).run();return json({error:'We could not email your code. Please try again later.'},502)}
   return json({challenge:id,message:'Check your email for an 8-digit code. It expires in 10 minutes.'});
  }
  if(body.action==='verify'){
   const id=String(body.challenge||''),code=String(body.code||'').trim();
   const pin=body.pin===undefined?null:String(body.pin);
   if(pin!==null&&!/^\d{6}$/.test(pin))return json({error:'Choose a 6-digit PIN using numbers only.'},400);
   if(!/^[a-f0-9]{64}$/.test(id)||!/^\d{8}$/.test(code))return json({error:'Enter the 8-digit code from your email.'},400);
   const row=await db.prepare('UPDATE parent_challenges SET attempts=attempts+1 WHERE id=? AND expires>? AND attempts<5 RETURNING email,name,hash').bind(id,Date.now()).first();
   if(!row||row.hash!==await hash(id+':'+code))return json({error:'That code is incorrect or expired. After 5 attempts, request a new code.'},403);
   const consumed=await db.prepare('DELETE FROM parent_challenges WHERE id=? RETURNING email,name').bind(id).first();
   if(!consumed)return json({error:'This code has already been used.'},403);
   const token=random(),now=Date.now(),salt=pin!==null?random():null,pinDigest=pin!==null?await pinHash(pin,salt):null;
   await db.batch([
    ...(pin!==null?[
     db.prepare('DELETE FROM parent_sessions WHERE email=?').bind(consumed.email),
     db.prepare('INSERT INTO parent_pins (email,salt,hash,updated) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,updated=excluded.updated').bind(consumed.email,salt,pinDigest,now),
     db.prepare('DELETE FROM parent_challenges WHERE email=?').bind(consumed.email)
    ]:[]),
    db.prepare('INSERT INTO parent_sessions (hash,email,expires) VALUES (?,?,?)').bind(await hash(token),consumed.email,now+30*86400000),
    db.prepare('INSERT INTO parent_accounts (email,name,created,last_seen) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen').bind(consumed.email,consumed.name,now,now),
    db.prepare('DELETE FROM parent_sessions WHERE expires<?').bind(now),
    db.prepare('DELETE FROM parent_challenges WHERE expires<?').bind(now)
   ]);
   return signedResponse(token);
  }
  const ses=await session(request,db);if(!ses)return json({error:'Please sign in again.'},401);
  if(body.action==='save_family'){
   const entries=Array.isArray(body.entries)?body.entries:[];
   if(entries.length>20)return json({error:'Too many team entries.'},400);
   const clean=entries.map((x,i)=>({entry_id:cleanName(x.entry_id||`entry-${i}`,80),team_code:cleanName(x.team_code,32).toUpperCase(),child_name:cleanName(x.child_name,60),created:Number(x.created)||Date.now()})).filter(x=>x.entry_id&&x.team_code);
   if(new Set(clean.map(x=>x.entry_id)).size!==clean.length)return json({error:'Duplicate team entries.'},400);
   await db.batch([db.prepare('DELETE FROM parent_family WHERE email=?').bind(ses.email),...clean.map(x=>db.prepare('INSERT INTO parent_family (email,entry_id,team_code,child_name,created) VALUES (?,?,?,?,?)').bind(ses.email,x.entry_id,x.team_code,x.child_name,x.created))]);
   return json({success:true,count:clean.length});
  }
  if(body.action==='update_name'){
   const name=cleanName(body.name);if(!name)return json({error:'Enter your name.'},400);
   await db.prepare('UPDATE parent_accounts SET name=?,last_seen=? WHERE email=?').bind(name,Date.now(),ses.email).run();return json({success:true});
  }
  if(body.action==='logout'){
   const token=(request.headers.get('Cookie')||'').match(/__Host-ks_parent=([a-f0-9]{64})/)?.[1];if(token)await db.prepare('DELETE FROM parent_sessions WHERE hash=?').bind(await hash(token)).run();
   const r=json({success:true});r.headers.set('Set-Cookie',`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);return r;
  }
  return json({error:'Unknown action.'},400);
 }catch{return json({error:'We could not complete that step. Please try again.'},500)}
}

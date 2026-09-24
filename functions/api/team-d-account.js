// Isolated Team D pilot. No access to legacy roster, parent contacts or SMS.
const COOKIE='__Host-ks_team_d';
const MEMBERS={'britt.roth@me.com':{name:'Britt',role:'Coach'},'jodicae@yahoo.com':{name:'Jodi',role:'Assistant Coach'}};
const ORIGIN='https://kanabsports.com';
const encode=new TextEncoder();
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function schema(db){for(const sql of [
 'CREATE TABLE IF NOT EXISTS team_d_challenges (id TEXT PRIMARY KEY,email TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS team_d_sessions (hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_members (email TEXT PRIMARY KEY,joined INTEGER NOT NULL,last_seen INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS team_d_notes (id TEXT PRIMARY KEY,email TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)'
])await db.prepare(sql).run()}
async function limit(db,key,max){const r=await db.prepare('INSERT INTO team_d_limits (key,count) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key).first();return r.count<=max}
async function session(request,db){const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-ks_team_d=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;const row=await db.prepare('SELECT email FROM team_d_sessions WHERE hash=? AND expires>?').bind(await hash(token),Date.now()).first();return row&&MEMBERS[row.email]?row.email:null}
export async function onRequest({request,env}){
 if(!env.SPORTS_DB||!env.RESEND_API_KEY)return json({error:'Team D signup is not ready. Please try again later.'},503);
 const db=env.SPORTS_DB;
 try{
  await schema(db);
  if(request.method==='GET'){
   const email=await session(request,db);if(!email)return json({signedIn:false});
   const members=await db.prepare('SELECT email,joined FROM team_d_members').all();
   const notes=await db.prepare('SELECT email,body,created FROM team_d_notes ORDER BY created DESC LIMIT 30').all();
   return json({signedIn:true,member:MEMBERS[email],members:(members.results||[]).filter(m=>MEMBERS[m.email]).map(m=>({...MEMBERS[m.email],joined:m.joined})),notes:(notes.results||[]).map(n=>({name:MEMBERS[n.email]?.name||'Coach',body:n.body,created:n.created}))});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==ORIGIN||new URL(request.url).origin!==ORIGIN)return json({error:'Open signup at kanabsports.com.'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
  const raw=await request.text();if(raw.length>4000)return json({error:'Request too large.'},413);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
  if(body.action==='request_code'){
   const email=String(body.email||'').trim().toLowerCase();
   if(!MEMBERS[email])return json({error:'This pilot is for Britt and Jodi. Use the email address where Jeff sent your invitation.'},403);
   const hour=Math.floor(Date.now()/3600000),ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown');
   if(!await limit(db,`ip:${ip}:${hour}`,20)||!await limit(db,`email:${email}:${hour}`,5))return json({error:'Too many code requests. Please try again in an hour.'},429);
   const id=random(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
   await db.prepare('INSERT INTO team_d_challenges (id,email,hash,expires) VALUES (?,?,?,?)').bind(id,email,await hash(id+':'+code),Date.now()+600000).run();
   let sent;try{sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[email],subject:'Your Team D signup code',text:`Hi ${MEMBERS[email].name},\n\nYour Kanab Sports code is: ${code}\n\nEnter it at https://kanabsports.com/team-d/ to join Team D as ${MEMBERS[email].role}. This code expires in 10 minutes and can only be used once.\n\nIf you did not request this code, ignore this email. Never share your code.\n\nKanab Sports`})})}catch{}
   if(!sent?.ok){await db.prepare('DELETE FROM team_d_challenges WHERE id=?').bind(id).run();return json({error:'We could not email your code. Please try again later.'},502)}
   return json({challenge:id,message:'Check your email for an 8-digit code. It expires in 10 minutes.'});
  }
  if(body.action==='verify'){
   const id=String(body.challenge||''),code=String(body.code||'').trim();
   if(!/^[a-f0-9]{64}$/.test(id)||!/^\d{8}$/.test(code))return json({error:'Enter the 8-digit code from your email.'},400);
   const row=await db.prepare('UPDATE team_d_challenges SET attempts=attempts+1 WHERE id=? AND expires>? AND attempts<5 RETURNING email,hash').bind(id,Date.now()).first();
   if(!row||row.hash!==await hash(id+':'+code))return json({error:'That code is incorrect or expired. After 5 attempts, request a new code.'},403);
   const consumed=await db.prepare('DELETE FROM team_d_challenges WHERE id=? RETURNING email').bind(id).first();
   if(!consumed||!MEMBERS[consumed.email])return json({error:'This code has already been used.'},403);
   const token=random(),now=Date.now();
   await db.batch([
    db.prepare('INSERT INTO team_d_sessions (hash,email,expires) VALUES (?,?,?)').bind(await hash(token),consumed.email,now+7*86400000),
    db.prepare('INSERT INTO team_d_members (email,joined,last_seen) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET last_seen=excluded.last_seen').bind(consumed.email,now,now),
    db.prepare('DELETE FROM team_d_sessions WHERE expires<?').bind(now),
    db.prepare('DELETE FROM team_d_challenges WHERE expires<?').bind(now)
   ]);
   const r=json({success:true});r.headers.set('Set-Cookie',`${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800`);return r;
  }
  const email=await session(request,db);if(!email)return json({error:'Please sign in again.'},401);
  if(body.action==='logout'){
   const token=(request.headers.get('Cookie')||'').match(/__Host-ks_team_d=([a-f0-9]{64})/)?.[1];await db.prepare('DELETE FROM team_d_sessions WHERE hash=?').bind(await hash(token)).run();
   const r=json({success:true});r.headers.set('Set-Cookie',`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);return r;
  }
  if(body.action==='note'){
   const note=String(body.note||'').trim();if(!note||note.length>1000)return json({error:'Write a note of up to 1,000 characters.'},400);
   if(!await limit(db,`note:${email}:${Math.floor(Date.now()/60000)}`,10))return json({error:'Please wait a minute before posting again.'},429);
   await db.prepare('INSERT INTO team_d_notes (id,email,body,created) VALUES (?,?,?,?)').bind(random(),email,note,Date.now()).run();return json({success:true});
  }
  return json({error:'Unknown action.'},400);
 }catch{return json({error:'We could not complete that step. Please try again.'},500)}
}

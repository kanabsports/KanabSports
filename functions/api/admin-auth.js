const OWNER_EMAIL='howdy@kanabsports.com';

export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return page('Admin sign-in is not connected.',503);
  await schema(env.SPORTS_DB);const url=new URL(request.url),token=clean(url.searchParams.get('token'),200);
  if(!token)return page('This sign-in link is invalid.',400);
  const hash=await sha256(token),row=await env.SPORTS_DB.prepare(`SELECT id,email FROM admin_login_tokens WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1`).bind(hash).first();
  if(!row)return page('This sign-in link is invalid or expired.',410);
  const reserved=await env.SPORTS_DB.prepare(`UPDATE admin_login_tokens SET used_at=datetime('now') WHERE id=? AND used_at IS NULL`).bind(row.id).run();
  if(!reserved.meta?.changes)return page('This sign-in link has already been used.',409);
  const session=randomToken(),sessionHash=await sha256(session),expires=new Date(Date.now()+8*60*60*1000).toISOString();
  await env.SPORTS_DB.prepare(`INSERT INTO admin_sessions (id,email,token_hash,expires_at,created_at) VALUES (?,?,?,?,datetime('now'))`).bind(crypto.randomUUID(),row.email,sessionHash,expires).run();
  return new Response(null,{status:302,headers:{Location:'/admin.html','Set-Cookie':`ks_admin=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,'Cache-Control':'no-store'}});
}

export async function onRequestPost({request,env}){
  try{
    if(!env.SPORTS_DB||!env.RESEND_API_KEY||!env.TURNSTILE_SECRET_KEY)return json({success:false,error:'Admin sign-in is not configured yet.'},503);
    const form=await request.formData(),action=clean(form.get('action'),40);
    if(action==='logout')return new Response(JSON.stringify({success:true}),{headers:{'Content-Type':'application/json','Set-Cookie':'ks_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0','Cache-Control':'no-store'}});
    if(clean(form.get('website'),100))return json({success:true});
    const email=clean(form.get('email'),180).toLowerCase(),turnstile=clean(form.get('cf-turnstile-response'),3000);
    if(email!==OWNER_EMAIL)return json({success:true,message:'If this address is authorized, a sign-in link will arrive shortly.'});
    if(!turnstile)return json({success:false,error:'Please wait for verification to finish.'},400);
    if(!(await verifyTurnstile(request,env.TURNSTILE_SECRET_KEY,turnstile)))return json({success:false,error:'Human verification failed. Please refresh and try again.'},403);
    await schema(env.SPORTS_DB);await env.SPORTS_DB.prepare(`DELETE FROM admin_login_tokens WHERE datetime(expires_at)<=datetime('now') OR used_at IS NOT NULL`).run();
    const id=crypto.randomUUID(),token=randomToken(),hash=await sha256(token),expires=new Date(Date.now()+15*60*1000).toISOString(),origin=new URL(request.url).origin,link=`${origin}/api/admin-auth?token=${encodeURIComponent(token)}`;
    await env.SPORTS_DB.prepare(`INSERT INTO admin_login_tokens (id,email,token_hash,expires_at,created_at) VALUES (?,?,?,?,datetime('now'))`).bind(id,email,hash,expires).run();
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`admin-login-${id}`},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[email],subject:'Your Kanab Sports admin sign-in link',text:`Open this private link to sign in to the Kanab Sports dashboard:\n${link}\n\nIt expires in 15 minutes and can only be used once.`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:600px"><div style="font-size:12px;font-weight:800;color:#a51420;text-transform:uppercase">Kanab Sports Admin</div><h2>Your private sign-in link</h2><p><a href="${esc(link)}" style="display:block;background:#e32636;color:#fff;text-decoration:none;text-align:center;font-size:18px;font-weight:800;padding:17px 22px;border-radius:10px">Open Admin Dashboard</a></p><p style="color:#666;font-size:13px">This link expires in 15 minutes and can only be used once.</p></div>`})});
    if(!sent.ok){await env.SPORTS_DB.prepare(`DELETE FROM admin_login_tokens WHERE id=?`).bind(id).run();return json({success:false,error:'The sign-in email could not be delivered. Please try again.'},502)}
    return json({success:true,message:'Check howdy@kanabsports.com for your private sign-in link.'});
  }catch(error){console.error('admin auth error',error);return json({success:false,error:'Something went wrong. Please try again.'},500)}
}

async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS admin_login_tokens (id TEXT PRIMARY KEY,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();await db.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function verifyTurnstile(request,secret,response){const body=new URLSearchParams({secret,response}),ip=request.headers.get('CF-Connecting-IP');if(ip)body.set('remoteip',ip);const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});return r.ok&&Boolean((await r.json()).success)}
function randomToken(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function clean(v,max=500){return String(v||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
function esc(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function page(message,status){return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>Kanab Sports Admin</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#fff;font-family:Arial}.card{width:min(520px,calc(100% - 40px));padding:30px;background:#16181d;border-radius:16px}a{color:#fff}</style><div class="card"><h1>${esc(message)}</h1><a href="/admin.html">Back to admin sign-in</a></div>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

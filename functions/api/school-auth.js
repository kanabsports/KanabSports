import {schoolSchema,schoolSession,schoolRoles,trustedOrigin} from '../_lib/school-access.js';
import {json,sha256,randomToken} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'School login is unavailable.'},503);
 const db=env.SPORTS_DB;
 try{
 await schoolSchema(db);
 if(request.method==='GET'){const session=await schoolSession(request,db),roles=await schoolRoles(db,session?.email);return json({authenticated:roles.length>0,email:roles.length?session.email:null,roles})}
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open Kanab Sports to sign in.'},403);
 const raw=await request.text();if(raw.length>2000)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(body.action==='logout'){
  const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-pep_school=([a-f0-9]{64})(?:;|$)/)?.[1];if(token)await db.prepare('DELETE FROM school_sessions WHERE hash=?').bind(await sha256(token)).run();
  const r=json({success:true});r.headers.set('Set-Cookie','__Host-pep_school=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');return r;
 }
 const email=String(body.email||'').trim().toLowerCase();
 if(!['request_code','verify'].includes(body.action)||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter an authorized school email.'},400);
 const period=Math.floor(Date.now()/900000),ip=request.headers.get('CF-Connecting-IP')||'unknown';
 await db.prepare('DELETE FROM school_auth_limits WHERE expires<?').bind(Date.now()).run();
 for(const [value,max] of [[email,body.action==='request_code'?5:10],[ip,40]]){
  const key=body.action+':'+await sha256(value)+':'+period;
  const count=await db.prepare('INSERT INTO school_auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,(period+1)*900000).first();
  if(count.count>max)return json({error:'Too many attempts. Please wait 15 minutes.'},429);
 }
 const roles=await schoolRoles(db,email);
 if(body.action==='request_code'){
  if(!roles.length)return json({success:true,message:'If this email has school permissions, a code will arrive shortly.'});
  if(!env.RESEND_API_KEY)return json({error:'Email is unavailable.'},503);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0'),hash=await sha256(code);
  await db.prepare('INSERT INTO school_login_codes VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash,expires=excluded.expires').bind(email,hash,Date.now()+600000).run();
  try{
   const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[email],subject:'Your Pep school sign-in code',text:`Your Pep school sign-in code is ${code}. It expires in 10 minutes. Do not share this code. Sign in at https://kanabsports.com/school-portal`})});if(!r.ok)throw Error('delivery');
  }catch{await db.prepare('DELETE FROM school_login_codes WHERE email=? AND hash=?').bind(email,hash).run();return json({error:'The email could not be sent. Please try again.'},502)}
  return json({success:true,message:'If this email has school permissions, a code will arrive shortly.'});
 }
 if(!roles.length||!/^\d{6}$/.test(String(body.code)))return json({error:'Invalid or expired code.'},403);
 const consumed=await db.prepare('DELETE FROM school_login_codes WHERE email=? AND hash=? AND expires>? RETURNING email').bind(email,await sha256(body.code),Date.now()).first();if(!consumed)return json({error:'Invalid or expired code.'},403);
 const token=randomToken();await db.prepare('INSERT INTO school_sessions VALUES(?,?,?)').bind(await sha256(token),email,Date.now()+8*3600000).run();
 const r=json({success:true});r.headers.set('Set-Cookie',`__Host-pep_school=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`);return r;
 }catch{return json({error:'School login could not complete.'},500)}
}

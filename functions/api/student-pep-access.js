import {randomToken,sha256,validEmail,json} from '../_lib/coach-auth.js';
import {messagingOrigin,throttle} from '../_lib/private-messages.js';
import {audienceSchema,channels} from '../_lib/pep-audiences.js';
import {sendEmail} from '../_lib/score-invitations.js';

const cookie='__Host-pep_student';
export async function studentSession(request,db){
  const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-pep_student=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)return null;
  return db.prepare('SELECT email FROM pep_student_sessions WHERE hash=? AND expires>?').bind(await sha256(token),Date.now()).first();
}
export async function onRequestPost({request,env}){
  if(env.PRIVATE_MESSAGING_ENABLED!=='true'||env.PEP_STUDENT_AUDIENCE_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Student access is unavailable.'},503);
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open Pep to sign in.'},403);
  try{
    const raw=await request.text();if(raw.length>1100)return json({error:'Request too large.'},413);
    const b=JSON.parse(raw),db=env.SPORTS_DB;await audienceSchema(db);
    await db.prepare('DELETE FROM pep_student_links WHERE expires<=?').bind(Date.now()).run();
    await db.prepare('DELETE FROM pep_student_sessions WHERE expires<=?').bind(Date.now()).run();
    if(b.action==='logout'){
      const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-pep_student=([a-f0-9]{64})(?:;|$)/)?.[1];
      if(token)await db.prepare('DELETE FROM pep_student_sessions WHERE hash=?').bind(await sha256(token)).run();
      const r=json({success:true});r.headers.append('Set-Cookie',cookie+'=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return r;
    }
    if(b.action==='redeem'){
      if(!/^[a-f0-9]{64}$/.test(b.token||''))return json({error:'Invalid sign-in link.'},400);
      const link=await db.prepare('DELETE FROM pep_student_links WHERE hash=? AND expires>? RETURNING email').bind(await sha256(b.token),Date.now()).first();
      if(!link)return json({error:'Sign-in link expired or already used.'},403);
      const token=randomToken(),ttl=8*3600;
      await db.prepare('INSERT INTO pep_student_sessions VALUES(?,?,?)').bind(await sha256(token),link.email,Date.now()+ttl*1000).run();
      const r=json({success:true});r.headers.append('Set-Cookie',cookie+'='+token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+ttl);return r;
    }
    const email=String(b.email||'').trim().toLowerCase();
    if(b.action!=='request'||email.length>254||!validEmail(email))return json({error:'Enter your registered email.'},400);
    if(!await throttle(db,{role:'student-sign-in',id:request.headers.get('CF-Connecting-IP')||'local'}))return json({error:'Please try again in a minute.'},429);
    const generic=json({message:'If your program has enabled shared Pep Talks for this email, a sign-in link will arrive shortly.'});
    const scope=channels({role:'student',id:email},true);
    if(!await db.prepare('SELECT 1 FROM ('+scope.sql+') LIMIT 1').bind(...scope.args).first())return generic;
    const token=randomToken(),now=Date.now();
    const hash=await sha256(token);
    const issued=await db.prepare('INSERT INTO pep_student_links SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM pep_student_links WHERE email=? AND expires>?) RETURNING hash').bind(hash,email,now+600000,email,now+540000).first();
    if(issued)await sendEmail(env,{to:[email],subject:'Sign in to Pep',text:'Open your private one-time sign-in link within ten minutes. '+messagingOrigin(env)+'/messages/team.html?role=student#'+token},'student-login-'+hash);
    return generic;
  }catch{return json({error:'Student sign-in is temporarily unavailable.'},503);}
}

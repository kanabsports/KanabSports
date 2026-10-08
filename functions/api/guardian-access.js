import {teamPolicy} from '../_lib/school-access.js';
import {accessSchema,parentSession} from '../_lib/parent-access.js';
import {authenticate} from './admin-dashboard.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'Access management is unavailable.'},503);
 const db=env.SPORTS_DB;
 try{
 await accessSchema(db);
 const owner=await authenticate(request,db);
 if(request.method==='GET'){
  if(!owner)return json({error:'Sign in to the owner admin account.'},401);
  const memberships=(await db.prepare('SELECT * FROM guardian_memberships ORDER BY created DESC LIMIT 300').all()).results||[];
  const requests=(await db.prepare("SELECT * FROM parent_access_requests WHERE status='pending' ORDER BY created DESC LIMIT 100").all()).results||[];
  return json({memberships,requests});
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!=='https://kanabsports.com'||new URL(request.url).origin!=='https://kanabsports.com')return json({error:'Open Kanab Sports to manage access.'},403);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 const code=String(body.team_code||'').trim().toUpperCase();
 if(body.action==='request'){
  const parent=await parentSession(request,db);if(!parent)return json({error:'Sign in to My Family to request access.'},401);
  if(!/^[A-Z0-9_-]{1,32}$/.test(code))return json({error:'Invalid team code.'},400);
  const team=await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(code).first();if(!team)return json({error:'Team not found.'},404);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM parent_access_requests WHERE email=?').bind(parent.email).first();if(Number(count?.n)>=20)return json({error:'Contact your school to manage additional requests.'},429);
  await db.prepare("INSERT OR IGNORE INTO parent_access_requests(email,team_code,status,created) VALUES(?,?,'pending',?)").bind(parent.email,code,Date.now()).run();
  return json({success:true,message:'Access requested. Your school must verify your guardian relationship before private team information is available.'});
 }
 if(!owner)return json({error:'Owner admin approval is required.'},403);
 if(body.action==='revoke'){
  const id=String(body.id||'');const found=await db.prepare('SELECT id FROM guardian_memberships WHERE id=?').bind(id).first();if(!found)return json({error:'Membership not found.'},404);
  await db.batch([db.prepare("UPDATE guardian_memberships SET status='revoked' WHERE id=?").bind(id),db.prepare('INSERT INTO guardian_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,owner.email,'revoke',Date.now())]);return json({success:true});
 }
 if(body.action!=='approve')return json({error:'Unknown action.'},400);
 const policy=await teamPolicy(db,code);if(!policy||policy.kind==='school')return json({error:'School approvals require the School Portal. Assign rec or travel teams in School Setup before approving contacts here.'},403);
 const email=String(body.email||'').trim().toLowerCase(),student=String(body.student_ref||'').trim(),season=String(body.season||'').trim(),evidence=String(body.evidence||'').trim(),expires=Date.parse(body.expires);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!student||student.length>100||!season||season.length>80||evidence.length<10||evidence.length>500||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+366*86400000||!body.confirmed)return json({error:'Provide a guardian email, school student reference, season, school authorization reference and an expiry within one year. Confirm school authorization.'},400);
 const team=await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(code).first();if(!team)return json({error:'An active coach-created team code is required.'},400);
 const id=crypto.randomUUID(),now=Date.now();
 await db.batch([db.prepare("INSERT INTO guardian_memberships VALUES(?,?,?,?,?,?,'approved',?,?,?)").bind(id,email,code,student,season,expires,owner.email,evidence,now),db.prepare('INSERT INTO guardian_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,owner.email,'approve',now),db.prepare("UPDATE parent_access_requests SET status='approved' WHERE email=? AND team_code=?").bind(email,code)]);
 return json({success:true,id});
 }catch(e){console.error('guardian access failed');return json({error:'Access could not be updated.'},500)}
}

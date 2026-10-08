import {authenticate} from './admin-dashboard.js';
import {accessSchema} from '../_lib/parent-access.js';
import {validateRosterRows} from '../../assets/guardian-import.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!env.SPORTS_DB)return json({error:'Import is unavailable.'},503);
 if(request.headers.get('Origin')!=='https://kanabsports.com'||new URL(request.url).origin!=='https://kanabsports.com')return json({error:'Open Kanab Sports to import.'},403);
 const db=env.SPORTS_DB;
 try{
 const owner=await authenticate(request,db);if(!owner)return json({error:'Sign in to the owner account. Athletic-director accounts are not enabled yet.'},401);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Only confirmed roster records are accepted.'},415);
 const raw=await request.text();if(raw.length>100000)return json({error:'Import too large.'},413);
 let body,rows;try{body=JSON.parse(raw);rows=validateRosterRows(body.rows)}catch(e){return json({error:e.message||'Invalid roster.'},400)}
 const evidence=String(body.evidence||'').trim();if(body.confirmed!==true||evidence.length<10||evidence.length>500)return json({error:'Confirm school authorization and provide its record reference.'},400);
 await accessSchema(db);const operations=[];let skipped=0;
 for(const r of rows){
  const team=await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(r.team_code).first();if(!team)return json({error:'Unknown or inactive team '+r.team_code+'. Nothing was imported.'},400);
  const previous=await db.prepare('SELECT status,expires FROM guardian_memberships WHERE email=? AND team_code=? AND student_ref=? AND season=?').bind(r.email,r.team_code,r.student_ref,r.season).all();
  if(previous.results?.length){if(previous.results.some(x=>x.status!=='approved'||x.expires!==Date.parse(r.expires+'T00:00:00Z')))return json({error:'A row conflicts with existing or revoked access. Review it individually in Guardian Access. Nothing was imported.'},409);skipped++;continue;}
  const key=JSON.stringify([r.email,r.team_code,r.student_ref,r.season]),id='import-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now();
  operations.push(db.prepare("INSERT INTO guardian_memberships VALUES(?,?,?,?,?,?,'approved',?,?,?)").bind(id,r.email,r.team_code,r.student_ref,r.season,Date.parse(r.expires+'T00:00:00Z'),owner.email,evidence,now),db.prepare('INSERT INTO guardian_access_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,owner.email,'import_approve',now),db.prepare("UPDATE parent_access_requests SET status='approved' WHERE email=? AND team_code=?").bind(r.email,r.team_code));
 }
 if(operations.length)await db.batch(operations);
 return json({success:true,imported:rows.length-skipped,skipped,message:'Access records saved. No source file was uploaded and no invitations were sent.'});
 }catch{return json({error:'Import could not complete. Refresh and review the memberships before retrying.'},500)}
}

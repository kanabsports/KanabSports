import {json,getCoach} from '../_lib/coach-auth.js';
import {schema,eligibleSQL,eligible} from '../_lib/private-messages.js';
export async function onRequest({request,env}){
 if(env.PRIVATE_MESSAGING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Messaging pilot is not enabled.'},503);
 try{if(request.method!=='GET')return json({error:'Method not allowed.'},405);const db=env.SPORTS_DB,coach=await getCoach(request,db);if(!coach)return json({error:'Sign in with your approved coach account.'},401);await schema(db);
 const teams=(await db.prepare(eligibleSQL+' AND a.id=?').bind(coach.id).all()).results||[],families=[];
 for(const t of teams){const rows=(await db.prepare("SELECT DISTINCT g.email,g.student_ref,p.name FROM guardian_memberships g JOIN parent_accounts p ON p.email=g.email WHERE g.team_code=? AND g.status='approved' AND g.expires>?").bind(t.team_code,Date.now()).all()).results||[];
 let roster=[];try{const uploads=(await db.prepare("SELECT r.payload_json FROM coach_roster_uploads r JOIN coach_documents d ON d.id=r.document_id JOIN coach_access_requests a ON a.id=r.coach_id WHERE a.team_code=? AND d.status='approved' ORDER BY r.created DESC LIMIT 1").bind(t.team_code).all()).results||[];roster=JSON.parse(uploads[0]?.payload_json||'[]');}catch{}
 for(const r of rows){if(!await eligible(db,t.team_code,coach.id,r.email,t.organization_id))continue;const student=roster.find(s=>s.student_ref===r.student_ref);families.push({team:t.team_name,team_code:t.team_code,organization_id:t.organization_id,parent_email:r.email,parent_name:r.name,student_ref:r.student_ref,student_name:student?.student_name||student?.player_name||'Athlete '+r.student_ref});}
 }
 return json({families,studentMessaging:false});
 }catch{return json({error:'Family directory unavailable.'},503);}
}

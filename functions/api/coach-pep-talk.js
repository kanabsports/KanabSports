import {getCoach,json} from '../_lib/coach-auth.js';
import {schema,messagingTeams} from '../_lib/private-messages.js';
import {schoolSchema,trustedOrigin} from '../_lib/school-access.js';

export async function onRequest({request,env}){
 const db=env.SPORTS_DB;
 if(!db)return json({error:'Pep Talk storage unavailable.'},503);
 if(!['GET','POST'].includes(request.method))return json({error:'Method unavailable.'},405);
 if(request.method==='POST'&&!trustedOrigin(request))return json({error:'Use the Coach Portal to activate.'},403);
 try{
  const coach=await getCoach(request,db);
  if(!coach)return json({error:'Sign in with your approved coach account.'},401);
  if(!/^(head coach|assistant coach|coach)$/i.test(coach.role))return json({available:false,message:'An approved coaching role is required.'},request.method==='GET'?200:403);
  await schoolSchema(db);await schema(db);
  const code=coach.team_code;
  // The owner confirmed this specific travel team before self-activation shipped.
  // An existing school or district assignment always takes precedence.
  const confirmedTeam=code==='KS-SY7AA4'&&coach.name.trim().toLowerCase()==='clayton cutler';
  const policy=await db.prepare('SELECT kind,school_id FROM school_teams WHERE team_code=?').bind(code||'').first();
  const confirmedCorrection=confirmedTeam&&(!policy||(policy.kind==='rec'&&policy.school_id===null));
  if(!(policy?.kind==='travel'&&policy.school_id===null)&&!confirmedCorrection)
   return json({available:false,message:'Coach activation requires an approved travel team assignment.'},request.method==='GET'?200:403);
  const source=" FROM coach_access_requests a JOIN school_teams s ON s.team_code=a.team_code WHERE a.id=? AND a.team_code=? AND a.status='approved' AND lower(a.role) IN ('head coach','assistant coach','coach') AND s.kind='travel' AND s.school_id IS NULL";
  if(request.method==='POST'){
   const writes=[];
   if(confirmedCorrection)writes.push(db.prepare("INSERT OR IGNORE INTO school_teams(team_code,kind,evidence,assigned_by) SELECT team_code,'travel','Owner-confirmed travel basketball beta','owner' FROM coach_access_requests WHERE id=? AND team_code=? AND status='approved' AND lower(trim(name))='clayton cutler' ON CONFLICT(team_code) DO UPDATE SET kind=excluded.kind,evidence=excluded.evidence,assigned_by=excluded.assigned_by WHERE school_teams.kind='rec' AND school_teams.school_id IS NULL").bind(coach.id,code));
   writes.push(db.prepare("INSERT OR IGNORE INTO private_message_teams(team_code,organization_id,name,enabled) SELECT a.team_code,?,COALESCE(NULLIF(a.team_name,''),a.organization),1"+source).bind(crypto.randomUUID(),coach.id,code));
   const enabled=" AND EXISTS(SELECT 1 FROM private_message_teams t WHERE t.team_code=a.team_code AND t.enabled=1)";
   writes.push(db.prepare("INSERT OR IGNORE INTO private_message_coaches(team_code,coach_id,active) SELECT a.team_code,a.id,1"+source+enabled).bind(coach.id,code));
   writes.push(db.prepare("INSERT OR IGNORE INTO travel_pep_activations(team_code,coach_id,created) SELECT a.team_code,a.id,?"+source+enabled+" AND EXISTS(SELECT 1 FROM private_message_coaches pc WHERE pc.team_code=a.team_code AND pc.coach_id=a.id AND pc.active=1)").bind(Date.now(),coach.id,code));
   await db.batch(writes);
  }
  const state=await db.prepare('SELECT t.enabled,pc.active,x.created FROM private_message_teams t LEFT JOIN private_message_coaches pc ON pc.team_code=t.team_code AND pc.coach_id=? LEFT JOIN travel_pep_activations x ON x.team_code=t.team_code AND x.coach_id=pc.coach_id WHERE t.team_code=?').bind(coach.id,code).first();
  if(state&&(state.enabled===0||state.active===0))return json({available:false,message:'Messaging was paused by the owner. Contact the owner to restore it.'});
  const active=Boolean(await db.prepare(messagingTeams(env)+' AND a.id=? AND t.team_code=?').bind(coach.id,code).first());
  if(request.method==='POST'&&!active)return json({error:'Your assignment changed. Refresh the Coach Portal.'},409);
  const needsStaffActivation=active&&coach.role.toLowerCase()==='head coach'&&!await db.prepare('SELECT 1 FROM travel_pep_staff_teams WHERE team_code=?').bind(code).first();
  return json({available:true,active,needsStaffActivation,message:needsStaffActivation?'Turn on Pep Talk for your approved coaching staff.':active?(coach.role.toLowerCase()==='head coach'?'Pep Talk is on for your approved coaching staff.':'Pep Talk is on for your coaching account and travel team.'):'Your travel coaching account is approved. You can turn on Pep Talk.'});
 }catch{return json({error:'Could not check Pep Talk. Refresh and try again.'},503)}
}

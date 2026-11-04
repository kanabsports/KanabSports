import {getCoach,json} from '../_lib/coach-auth.js';
import {authenticate} from './admin-dashboard.js';

export async function onRequestGet({request,env}){
  const db=env.SPORTS_DB;
  if(!db)return json({error:'Roster storage unavailable.'},503);
  try{
    const query=new URL(request.url).searchParams,owner=query.get('view')==='owner';
    const actor=owner?await authenticate(request,db):await getCoach(request,db);
    if(!actor)return json({error:owner?'Sign in to the owner account.':'Sign in with your verified coach account.'},401);
    const id=query.get('id');
    if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coach_roster_uploads'").first())return id?json({error:'Roster unavailable.'},404):json({rosters:[]});
    const source=` FROM coach_roster_uploads r JOIN coach_documents d ON d.id=r.document_id AND d.verification_id=r.coach_id
      JOIN coach_access_requests c ON c.id=r.coach_id JOIN school_teams s ON s.team_code=c.team_code
      WHERE d.status='approved' AND d.document_type='Roster' AND c.status='approved' AND s.kind IN ('rec','travel') AND s.school_id IS NULL
      AND d.team=COALESCE(NULLIF(c.team_name,''),c.organization) AND d.sport=c.sport`;
    const scope=source+(owner?'':' AND c.id=?'),args=owner?[]:[actor.id];
    const fields='r.document_id,d.team,d.season,c.team_code';
    if(!id){
      const rosters=(await db.prepare('SELECT '+fields+scope+' ORDER BY r.created DESC LIMIT 100').bind(...args).all()).results;
      return json({rosters});
    }
    const row=await db.prepare('SELECT '+fields+',r.payload_json'+scope+' AND r.document_id=?').bind(...args,id).first();
    if(!row)return json({error:'Roster unavailable.'},404);
    const {payload_json,...roster}=row;
    const players=JSON.parse(payload_json).map(({student_name,student_ref,guardians})=>({student_name,student_ref,guardians:(guardians||[]).map(({name,email})=>({name,email}))}));
    return json({roster,players});
  }catch{return json({error:'Could not load the approved roster.'},503);}
}

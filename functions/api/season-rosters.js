import {getCoach,json,sha256} from '../_lib/coach-auth.js';
import {authenticate} from './admin-dashboard.js';

const source=` FROM coach_roster_uploads r JOIN coach_documents d ON d.id=r.document_id AND d.verification_id=r.coach_id
      JOIN coach_access_requests c ON c.id=r.coach_id JOIN school_teams s ON s.team_code=c.team_code
      WHERE d.status='approved' AND d.document_type='Roster' AND c.status='approved' AND s.kind IN ('rec','travel') AND s.school_id IS NULL
      AND d.team=COALESCE(NULLIF(c.team_name,''),c.organization) AND d.sport=c.sport`;

export async function onRequestGet({request,env}){
  const db=env.SPORTS_DB;
  if(!db)return json({error:'Roster storage unavailable.'},503);
  try{
    const query=new URL(request.url).searchParams,owner=query.get('view')==='owner';
    const actor=owner?await authenticate(request,db):await getCoach(request,db);
    if(!actor)return json({error:owner?'Sign in to the owner account.':'Sign in with your verified coach account.'},401);
    const id=query.get('id');
    if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coach_roster_uploads'").first())return id?json({error:'Roster unavailable.'},404):json({rosters:[]});
    const scope=source+(owner?'':' AND c.id=?'),args=owner?[]:[actor.id];
    const fields='r.document_id,d.team,d.season,c.team_code';
    if(!id){
      const rosters=(await db.prepare('SELECT '+fields+scope+' ORDER BY r.created DESC LIMIT 100').bind(...args).all()).results;
      return json({rosters});
    }
    const row=await db.prepare('SELECT '+fields+',r.payload_json'+scope+' AND r.document_id=?').bind(...args,id).first();
    if(!row)return json({error:'Roster unavailable.'},404);
    const {payload_json,...roster}=row;
    const players=JSON.parse(payload_json).map(({student_name,student_ref,grade,guardians})=>({student_name,student_ref,grade:grade||'',guardians:(guardians||[]).map(({name,email})=>({name,email}))}));
    return json({roster,players,canEdit:!owner&&actor.role.toLowerCase()==='head coach',revision:await sha256(payload_json)});
  }catch{return json({error:'Could not load the approved roster.'},503);}
}

export async function onRequestPost({request,env}){
 const db=env.SPORTS_DB;
 if(!db)return json({error:'Roster storage unavailable.'},503);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open the Coach Portal to edit a roster.'},403);
 try{
  const coach=await getCoach(request,db);
  if(!coach||coach.role.toLowerCase()!=='head coach')return json({error:'Head coach access required.'},403);
  const body=await request.json().catch(()=>null);
  if(!body||!['edit','remove'].includes(body.action)||typeof body.student_ref!=='string'||!body.student_ref||typeof body.id!=='string')return json({error:'Choose a roster and player.'},400);
  const scope=source+" AND c.id=? AND lower(c.role)='head coach' AND r.document_id=?";
  const args=[coach.id,body.id];
  const row=await db.prepare('SELECT r.payload_json'+scope).bind(...args).first();
  if(!row)return json({error:'Roster unavailable.'},404);
  const conflict=()=>json({error:'Roster changed. Reload it before editing.'},409);
  if(await sha256(row.payload_json)!==body.revision)return conflict();
  const players=JSON.parse(row.payload_json);
  const matches=players.filter(p=>p.student_ref===body.student_ref);
  if(matches.length!==1)return json({error:'Player ID is missing or ambiguous. Review this roster.'},409);
  const player=matches[0];
  if(body.action==='remove')players.splice(players.indexOf(player),1);
  else{
   const name=typeof body.name==='string'?body.name.trim():'';
   const grade=typeof body.grade==='string'?body.grade.trim():'';
   if(!name||name.length>120||grade.length>30)return json({error:'Enter a name up to 120 characters and a grade up to 30 characters.'},400);
   Object.assign(player,{student_name:name,grade});
  }
  const saved=await db.prepare('UPDATE coach_roster_uploads SET payload_json=? WHERE document_id IN (SELECT r.document_id'+scope+') AND payload_json=? RETURNING document_id').bind(JSON.stringify(players),...args,row.payload_json).first();
  return saved?json({saved:true}):conflict();
 }catch{return json({error:'Could not update the roster. Reload and retry.'},503)}
}

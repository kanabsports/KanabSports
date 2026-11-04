import {getCoach,canManageAssistants,json} from '../_lib/coach-auth.js';
import {parentSession} from '../_lib/parent-access.js';
import {teamSchema} from './team-connection.js';
import {schoolSchema} from '../_lib/school-access.js';

const jeff='howdy@kanabsports.com';
const travel=` FROM coach_access_requests c JOIN school_teams t ON t.team_code=c.team_code
 WHERE c.status='approved' AND t.kind='travel' AND t.school_id IS NULL`;
const inviteFrom=` FROM pep_jeff_update_access g JOIN coach_access_requests sponsor ON sponsor.id=g.invited_by AND sponsor.team_code=g.team_code
 JOIN school_teams t ON t.team_code=g.team_code`;
const inviteWhere=` WHERE t.kind='travel' AND t.school_id IS NULL
 AND sponsor.status='approved' AND lower(sponsor.role) NOT LIKE '%assistant%'`;
const invited=inviteFrom+inviteWhere;
async function schema(db){
  await schoolSchema(db);await teamSchema(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS pep_jeff_update_access(team_code TEXT PRIMARY KEY,invited_by TEXT NOT NULL,start_row INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS pep_coach_help(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,team_code TEXT NOT NULL,coach_id TEXT NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS pep_coach_help_thread ON pep_coach_help(team_code,coach_id,seq)').run();
}
export async function onRequest({request,env}){
 const db=env.SPORTS_DB,url=new URL(request.url),role=url.searchParams.get('role');
 if(!db)return json({error:'Team help unavailable.'},503);
 try{
  let coach;
  if(role==='coach'){coach=await getCoach(request,db);if(!coach)return json({error:'Sign in as a verified coach.'},401);}
  else if(role==='parent'){const parent=await parentSession(request,db);if(parent?.email?.toLowerCase()!==jeff)return json({available:false},403);}
  else return json({error:'Unknown role.'},400);
  await schema(db);
  const code=coach?.team_code||url.searchParams.get('team')||'',id=coach?.id||url.searchParams.get('coach')||'';
  const eligible='SELECT 1'+travel+' AND c.team_code=? AND c.id=?';
  const permission=eligible+(role==='parent'?` AND (EXISTS(SELECT 1`+invited+` AND g.team_code=c.team_code) OR EXISTS(SELECT 1 FROM pep_coach_help h WHERE h.team_code=c.team_code AND h.coach_id=c.id AND h.role='coach'))`:'');
  if(request.method==='GET'){
   if(!coach&&!code&&!id){
    const peers=(await db.prepare('SELECT c.id,c.name,c.team_code,COALESCE(NULLIF(c.team_name,\'\'),c.organization) AS team'+travel+
     ' AND (EXISTS(SELECT 1'+invited+' AND g.team_code=c.team_code) OR EXISTS(SELECT 1 FROM pep_coach_help h WHERE h.team_code=c.team_code AND h.coach_id=c.id AND h.role=\'coach\')) ORDER BY team,c.name').all()).results;
    const updates=(await db.prepare('SELECT m.id,m.author,m.body,m.created_at,m.team_code,COALESCE(NULLIF(sponsor.team_name,\'\'),sponsor.organization) AS team'+inviteFrom+' JOIN coach_team_messages m ON m.team_code=g.team_code AND m.rowid>g.start_row'+inviteWhere+' ORDER BY m.rowid DESC LIMIT 100').all()).results;
    return json({available:true,peers,updates});
   }
   if(!await db.prepare(permission).bind(code,id).first())return json({available:false},403);
   const messages=(await db.prepare('SELECT role,body,created FROM (SELECT h.seq,h.role,h.body,h.created FROM pep_coach_help h WHERE h.team_code=? AND h.coach_id=? AND EXISTS('+permission+') ORDER BY h.seq DESC LIMIT 100) ORDER BY seq').bind(code,id,code,id).all()).results;
   const included=!!await db.prepare('SELECT 1'+invited+' AND g.team_code=?').bind(code).first();
   return json({available:true,messages,included,canInvite:!!coach&&canManageAssistants(coach)});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==url.origin)return json({error:'Open Kanab Sports to continue.'},403);
  const raw=await request.text();if(raw.length>7000)return json({error:'Request too large.'},413);
  const b=JSON.parse(raw);
  if(b.action==='include'){
   if(!canManageAssistants(coach)||typeof b.enabled!=='boolean')return json({error:'Lead coach required.'},403);
   const lead=eligible+" AND lower(c.role) NOT LIKE '%assistant%'";
   if(!await db.prepare(lead).bind(code,id).first())return json({error:'Travel team approval required.'},403);
   if(b.enabled){
    await db.prepare('INSERT INTO pep_jeff_update_access SELECT ?,?,COALESCE((SELECT MAX(rowid) FROM coach_team_messages),0) WHERE EXISTS('+lead+') ON CONFLICT(team_code) DO UPDATE SET invited_by=excluded.invited_by,start_row=CASE WHEN invited_by=excluded.invited_by THEN start_row ELSE excluded.start_row END').bind(code,id,code,id).run();
   }else await db.prepare('DELETE FROM pep_jeff_update_access WHERE team_code=? AND EXISTS('+lead+')').bind(code,code,id).run();
   return json({saved:true});
  }
  const body=typeof b.body==='string'?b.body.trim():'';
  if(b.action!=='post'||!body||body.length>2000||!/^\w{8}-(\w{4}-){3}\w{12}$/.test(b.id))return json({error:'Enter a note of up to 2,000 characters.'},400);
  const now=Date.now();
  const row=await db.prepare('INSERT OR IGNORE INTO pep_coach_help(id,team_code,coach_id,role,body,created) SELECT ?,?,?,?,?,? WHERE EXISTS('+permission+') AND (SELECT COUNT(*) FROM pep_coach_help WHERE team_code=? AND coach_id=? AND role=? AND created>?)<20 RETURNING id').bind(b.id,code,id,role,body,now,code,id,code,id,role,now-60000).first();
  if(!row){
   if(!await db.prepare(permission).bind(code,id).first())return json({error:'This conversation is unavailable.'},403);
   if(!await db.prepare('SELECT id FROM pep_coach_help WHERE id=? AND team_code=? AND coach_id=? AND role=? AND body=?').bind(b.id,code,id,role,body).first())return json({error:'Could not save this note. Refresh and try again shortly.'},409);
  }
  return json({saved:true});
 }catch{return json({error:'Team help is temporarily unavailable.'},503);}
}

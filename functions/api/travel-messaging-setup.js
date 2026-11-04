import {authenticate} from './admin-dashboard.js';
import {schema} from '../_lib/private-messages.js';
import {schoolSchema,schoolAudit,trustedOrigin} from '../_lib/school-access.js';
import {json} from '../_lib/coach-auth.js';

// Only independently approved travel teams appear. The production feature
// switch and each parent's verified guardian membership are separate gates.
const eligible=` FROM coach_access_requests c JOIN school_teams s ON s.team_code=c.team_code
  WHERE c.status='approved' AND s.kind='travel' AND s.school_id IS NULL`;
export async function onRequest({request,env}){
  const db=env.SPORTS_DB;if(!db)return json({error:'Team setup unavailable.'},503);
  try{
    const owner=await authenticate(request,db);if(!owner)return json({error:'Owner sign-in required.'},401);
    await schoolSchema(db);await schema(db);
    if(request.method==='GET'){
      const coaches=(await db.prepare(`SELECT c.team_code,c.id,c.name,c.role,c.team_name,c.organization,
        EXISTS(SELECT 1 FROM private_message_coaches p JOIN private_message_teams t ON t.team_code=p.team_code
        WHERE p.team_code=c.team_code AND p.coach_id=c.id AND p.active=1 AND t.enabled=1) AS enrolled`+eligible+' ORDER BY c.organization,c.name').all()).results;
      return json({online:env.PRIVATE_MESSAGING_ENABLED==='true',coaches});
    }
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(!trustedOrigin(request))return json({error:'Use the Kanab Sports owner portal.'},403);
    const raw=await request.text();if(raw.length>1800)return json({error:'Request too large.'},413);
    const b=JSON.parse(raw),evidence=String(b.evidence||'').trim(),code=String(b.team_code||''),coach=String(b.coach_id||'');
    if(!['enroll','remove'].includes(b.action)||b.confirmed!==true||evidence.length<10||evidence.length>500)return json({error:'Confirm the assignment and record the authorization reference.'},400);
    const verified=eligible+' AND c.id=? AND c.team_code=?';
    if(!await db.prepare('SELECT c.id'+verified).bind(coach,code).first())return json({error:'Choose an approved travel coach and team.'},403);
    if(b.action==='remove'){
      await db.batch([db.prepare('UPDATE private_message_coaches SET active=0 WHERE team_code=? AND coach_id=?').bind(code,coach),schoolAudit(db,null,code,owner.email,'remove_travel_coach',coach+' '+evidence)]);return json({saved:true});
    }
    // Never revive a disabled team or replace an existing organization mapping.
    const result=await db.batch([
      db.prepare("INSERT OR IGNORE INTO private_message_teams(team_code,organization_id,name,enabled) SELECT c.team_code,?,COALESCE(NULLIF(c.team_name,''),c.organization),1"+verified).bind(crypto.randomUUID(),coach,code),
      db.prepare('INSERT INTO private_message_coaches(team_code,coach_id,active) SELECT c.team_code,c.id,1'+verified+' AND EXISTS(SELECT 1 FROM private_message_teams t WHERE t.team_code=c.team_code AND t.enabled=1) ON CONFLICT(team_code,coach_id) DO UPDATE SET active=1').bind(coach,code),
      schoolAudit(db,null,code,owner.email,'request_travel_coach_enrollment',coach+' '+evidence)
    ]);
    if(!(result[1].meta?.changes??result[1].changes))return json({error:'This team is paused or its approval changed.'},409);
    return json({saved:true});
  }catch{return json({error:'Travel messaging setup could not be completed.'},500);}
}

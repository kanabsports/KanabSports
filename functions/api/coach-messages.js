import {pilotSchema} from '../_lib/pilot-schema.js';
import {messagingGate,teamPolicy} from '../_lib/school-access.js';
import {accessSchema} from '../_lib/parent-access.js';
import {findBlockedWords,LANGUAGE_NOTE} from '../../assets/pep-language.mjs';
import {getCoach,ensureCoachCore,sameOrigin,clean,json} from '../_lib/coach-auth.js';
import {notifyTeam} from '../_lib/web-push.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Coach messaging is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);await accessSchema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your coach account first.'},401);
    const teamCode=await ensureTeamCode(db,coach);
    const team=coach.team_name||coach.organization;

    if(request.method==='GET'){
      const rows=(await db.prepare(`
        SELECT id,author,body,created_at
        FROM coach_team_messages
        WHERE team_code=?
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT 50
      `).bind(teamCode).all()).results||[];
      const policy=await teamPolicy(db,teamCode);
      const selection=await db.prepare('SELECT kind,revision FROM coach_team_categories WHERE team_code=?').bind(teamCode).first();
      let eligibleGuardians=null;
      if(['rec','travel'].includes(policy?.kind)){await pilotSchema(db);eligibleGuardians=Number((await db.prepare("SELECT COUNT(DISTINCT email) n FROM guardian_memberships WHERE team_code=? AND status='approved' AND expires>?").bind(teamCode,Date.now()).first()).n);for(const row of rows){row.acknowledged=Number((await db.prepare("SELECT COUNT(DISTINCT r.email) n FROM pep_message_receipts r WHERE r.message_id=? AND r.team_code=? AND EXISTS(SELECT 1 FROM guardian_memberships m WHERE m.email=r.email AND m.team_code=r.team_code AND m.status='approved' AND m.expires>?)").bind(row.id,teamCode,Date.now()).first()).n)}}
      return json({success:true,gate:await messagingGate(db,teamCode),teamCode,team,category:selection?.kind||policy?.kind||null,categoryRevision:selection?.revision||0,approvedCategory:policy?.kind||null,sport:coach.sport,eligibleGuardians,messages:rows,inviteUrl:`${new URL(request.url).origin}/family/?code=${encodeURIComponent(teamCode)}`});
    }

    if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
    if(!sameOrigin(request))return json({success:false,error:'Open the Coach Portal at kanabsports.com.'},403);
    const body=await request.json(),action=clean(body.action,30);
    if(action==='set_category'){
      if(request.headers.get('Origin')!==new URL(request.url).origin||/assistant/i.test(coach.role))return json({error:'Only a verified lead coach can edit the team type.'},403);
      if(!['rec','school','travel'].includes(body.kind)||!Number.isSafeInteger(body.revision)||body.revision<0)return json({error:'Choose a team type and refresh the team first.'},400);
      await teamPolicy(db,teamCode);
      const row=await db.prepare(`INSERT INTO coach_team_categories(team_code,kind,coach_id,revision)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM coach_access_requests WHERE id=? AND team_code=? AND status='approved' AND lower(role) NOT LIKE '%assistant%')
        AND (EXISTS(SELECT 1 FROM coach_team_categories WHERE team_code=? AND revision=?) OR (?=0 AND NOT EXISTS(SELECT 1 FROM coach_team_categories WHERE team_code=?)))
        ON CONFLICT(team_code) DO UPDATE SET kind=excluded.kind,coach_id=excluded.coach_id,revision=excluded.revision
        WHERE coach_team_categories.revision=? RETURNING revision`).bind(teamCode,body.kind,coach.id,body.revision+1,coach.id,teamCode,teamCode,body.revision,body.revision,teamCode,body.revision).first();
      return row?json({success:true,revision:row.revision}):json({error:'Another coach changed the team. Reload and try again.'},409);
    }
    if(action!=='post')return json({success:false,error:'Unknown action.'},400);

    const gate=await messagingGate(db,teamCode);if(!gate.allowed)return json({success:false,code:'SCHOOL_APPROVAL_REQUIRED',error:gate.reason},403);
    const message=clean(body.body,1200);
    if(!message)return json({success:false,error:'Write a message first.'},400);
    if(findBlockedWords(message).length)return json({success:false,code:'BLOCKED_LANGUAGE',error:LANGUAGE_NOTE},422);
    const recent=await db.prepare(`SELECT count(*) AS n FROM coach_team_messages WHERE coach_id=? AND datetime(created_at)>=datetime('now','-1 minute')`).bind(coach.id).first();
    if(Number(recent?.n||0)>=5)return json({success:false,error:'Please wait a minute before posting another update.'},429);

    const id=crypto.randomUUID();
    const inserted=await db.prepare(`INSERT INTO coach_team_messages(id,coach_id,team_code,author,body,created_at)
      SELECT ?,?,?,?,?,datetime('now') WHERE EXISTS(SELECT 1 FROM school_teams t WHERE t.team_code=? AND (t.kind IN ('rec','travel') OR (t.kind='school' AND t.revision>0 AND t.revision=t.approved_revision AND t.active_batch IS NOT NULL AND t.expires>date('now')))) RETURNING id`)
      .bind(id,coach.id,teamCode,coach.name,message,teamCode).first();
    if(!inserted)return json({success:false,error:'School approval changed. Reload before sending.'},409);

    let pushed={accepted:0,failed:0};
    try{pushed=await notifyTeam(db,teamCode,id)}catch{}
    return json({success:true,id,teamCode,push:pushed,message:pushed.accepted?'Published to My Family and app notifications queued.':'Published to My Family. No parent app devices are currently subscribed.'});
  }catch(error){
    console.error('coach messages error',error);
    return json({success:false,error:'Could not load or post coach messages.'},500);
  }
}

export async function ensureTeamCode(db,coach){
  if(coach.team_code)return coach.team_code;
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let n=0;n<12;n++){
    const b=crypto.getRandomValues(new Uint8Array(6)),candidate='KS-'+Array.from(b,x=>chars[x%chars.length]).join('');
    // Reuse an assigned code, including one created by a concurrent request.
    const saved=await db.prepare(`UPDATE coach_access_requests SET team_code=COALESCE(team_code,(
      SELECT team_code FROM coach_access_requests WHERE status='approved' AND team_code IS NOT NULL
      AND lower(organization)=lower(?) AND lower(COALESCE(team_name,''))=lower(COALESCE(?,''))
      AND lower(sport)=lower(?) ORDER BY reviewed_at DESC LIMIT 1),?)
      WHERE id=? AND status='approved' AND NOT EXISTS(SELECT 1 FROM coach_access_requests WHERE team_code=?) RETURNING team_code`).bind(coach.organization,coach.team_name||'',coach.sport,candidate,coach.id,candidate).first();
    if(saved?.team_code)return saved.team_code;
  }
  throw new Error('Could not create team code');
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_team_messages(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,team_code TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try{await db.prepare('CREATE INDEX IF NOT EXISTS idx_coach_team_messages_code ON coach_team_messages(team_code,created_at)').run()}catch{}
}
import {getCoach,ensureCoachCore,sameOrigin,clean,json} from '../_lib/coach-auth.js';
import {notifyTeam} from '../_lib/web-push.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Coach messaging is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your coach account first.'},401);
    const teamCode=await ensureTeamCode(db,coach);
    const team=coach.team_name||coach.organization;

    if(request.method==='GET'){
      const rows=(await db.prepare(`
        SELECT id,author,body,created_at
        FROM coach_team_messages
        WHERE team_code=?
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).bind(teamCode).all()).results||[];
      return json({success:true,teamCode,team,sport:coach.sport,messages:rows,inviteUrl:`${new URL(request.url).origin}/family/?code=${encodeURIComponent(teamCode)}`});
    }

    if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
    if(!sameOrigin(request))return json({success:false,error:'Open the Coach Portal at kanabsports.com.'},403);
    const body=await request.json(),action=clean(body.action,30);
    if(action!=='post')return json({success:false,error:'Unknown action.'},400);

    const message=clean(body.body,1200);
    if(!message)return json({success:false,error:'Write a message first.'},400);
    const recent=await db.prepare(`SELECT count(*) AS n FROM coach_team_messages WHERE coach_id=? AND datetime(created_at)>=datetime('now','-1 minute')`).bind(coach.id).first();
    if(Number(recent?.n||0)>=5)return json({success:false,error:'Please wait a minute before posting another update.'},429);

    const id=crypto.randomUUID();
    await db.prepare(`INSERT INTO coach_team_messages(id,coach_id,team_code,author,body,created_at) VALUES(?,?,?,?,?,datetime('now'))`)
      .bind(id,coach.id,teamCode,coach.name,message).run();

    let pushed={accepted:0,failed:0};
    try{pushed=await notifyTeam(db,teamCode,id)}catch{}
    return json({success:true,id,teamCode,push:pushed,message:pushed.accepted?'Published to My Family and app notifications queued.':'Published to My Family. No parent app devices are currently subscribed.'});
  }catch(error){
    console.error('coach messages error',error);
    return json({success:false,error:'Could not load or post coach messages.'},500);
  }
}

async function ensureTeamCode(db,coach){
  if(coach.team_code)return coach.team_code;
  const existing=await db.prepare(`SELECT team_code FROM coach_access_requests WHERE team_code IS NOT NULL AND lower(organization)=lower(?) AND lower(COALESCE(team_name,''))=lower(COALESCE(?,'')) AND lower(sport)=lower(?) ORDER BY reviewed_at DESC LIMIT 1`).bind(coach.organization,coach.team_name||'',coach.sport).first();
  if(existing?.team_code){await db.prepare('UPDATE coach_access_requests SET team_code=? WHERE id=?').bind(existing.team_code,coach.id).run();return existing.team_code}
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let n=0;n<12;n++){
    const b=crypto.getRandomValues(new Uint8Array(6)),code='KS-'+Array.from(b,x=>chars[x%chars.length]).join('');
    const found=await db.prepare('SELECT id FROM coach_access_requests WHERE team_code=? LIMIT 1').bind(code).first();
    if(!found){await db.prepare('UPDATE coach_access_requests SET team_code=? WHERE id=?').bind(code,coach.id).run();return code}
  }
  throw new Error('Could not create team code');
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_team_messages(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,team_code TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try{await db.prepare('CREATE INDEX IF NOT EXISTS idx_coach_team_messages_code ON coach_team_messages(team_code,created_at)').run()}catch{}
}
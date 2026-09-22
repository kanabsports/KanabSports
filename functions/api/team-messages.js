// Shared coaching-staff inbox. Uses the existing, server-backed coach login.
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
export async function schema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS shared_teams (id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_coaches (team_id TEXT NOT NULL,coach_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('head','assistant')),PRIMARY KEY(team_id,coach_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_messages (id TEXT PRIMARY KEY,team_id TEXT NOT NULL,coach_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS team_messages_team ON team_messages(team_id,created_at,id)`)
  ]);
}
async function identity(request,db) {
  const match=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)ks_coach=([^;]+)/);
  if(!match)return null;
  let token;try{token=decodeURIComponent(match[1])}catch{return null}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return db.prepare(`SELECT a.id,a.name FROM coach_sessions s JOIN coach_access_requests a ON a.id=s.coach_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='approved' LIMIT 1`).bind(hash).first();
}
export async function onRequest({request,env}) {
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  if(!env.SPORTS_DB)return json({error:'Coach messaging is not configured.'},503);
  if(request.method==='POST' && request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Please submit from the coach portal.'},403);
  const db=env.SPORTS_DB;
  try {
    const coach=await identity(request,db);
    if(!coach)return json({error:'Sign in with your approved coach account.'},401);
    await schema(db);
    if(request.method==='GET') {
      const url=new URL(request.url),teamId=url.searchParams.get('team');
      const teams=(await db.prepare(`SELECT t.id,t.name,m.role FROM team_coaches m JOIN shared_teams t ON t.id=m.team_id WHERE m.coach_id=? ORDER BY t.name`).bind(coach.id).all()).results;
      if(!teamId)return json({coach,teams});
      if(!teams.some(t=>t.id===teamId))return json({error:'You do not have access to this team.'},403);
      const before=url.searchParams.get('before');
      if(before && (!Number.isSafeInteger(Number(before))||Number(before)<1))return json({error:'Invalid page.'},400);
      const rows=(await db.prepare(`SELECT m.rowid AS sequence,m.id,m.body,m.created_at,a.name AS sender,m.coach_id FROM team_messages m JOIN coach_access_requests a ON a.id=m.coach_id WHERE m.team_id=? AND m.rowid<? ORDER BY m.rowid DESC LIMIT 101`).bind(teamId,before?Number(before):Number.MAX_SAFE_INTEGER).all()).results;
      const more=rows.length>100;const messages=rows.slice(0,100).reverse();
      const staff=(await db.prepare(`SELECT a.id,a.name,m.role FROM team_coaches m JOIN coach_access_requests a ON a.id=m.coach_id WHERE m.team_id=? ORDER BY m.role DESC,a.name`).bind(teamId).all()).results;
      return json({coach,teams,staff,messages,older:more?messages[0].sequence:null});
    }
    if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON required.'},415);
    const raw=await request.text();if(raw.length>12000)return json({error:'Request too large.'},413);
    let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
    if(!body||typeof body!=='object')return json({error:'Invalid request.'},400);
    if(body.action==='create') {
      const name=String(body.name||'').trim();if(!name||name.length>100)return json({error:'Enter a team name up to 100 characters.'},400);
      const id=crypto.randomUUID();
      await db.batch([db.prepare('INSERT INTO shared_teams(id,name) VALUES(?,?)').bind(id,name),db.prepare("INSERT INTO team_coaches(team_id,coach_id,role) VALUES(?,?,'head')").bind(id,coach.id)]);
      return json({success:true,teamId:id},201);
    }
    const teamId=String(body.teamId||'');
    const membership=await db.prepare('SELECT role FROM team_coaches WHERE team_id=? AND coach_id=?').bind(teamId,coach.id).first();
    if(!membership)return json({error:'You do not have access to this team.'},403);
    if(body.action==='send') {
      const text=String(body.message||'').trim(),id=String(body.messageId||'');
      if(!text||text.length>4000||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Enter a message of 1–4,000 characters.'},400);
      // Membership is rechecked at write time; client-supplied sender names are never trusted.
      const result=await db.prepare(`INSERT OR IGNORE INTO team_messages(id,team_id,coach_id,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM team_coaches WHERE team_id=? AND coach_id=?)`).bind(id,teamId,coach.id,text,teamId,coach.id).run();
      if(!result.meta.changes){const existing=await db.prepare('SELECT id FROM team_messages WHERE id=? AND team_id=? AND coach_id=? AND body=?').bind(id,teamId,coach.id,text).first();if(!existing)return json({error:'Message was not sent. Refresh team access and try again.'},409)}
      return json({success:true,id});
    }
    if(!['add','remove'].includes(body.action))return json({error:'Unknown action.'},400);
    if(membership.role!=='head')return json({error:'Only the head coach can manage team access.'},403);
    if(body.action==='add') {
      const email=String(body.email||'').trim().toLowerCase();
      const target=await db.prepare("SELECT id FROM coach_access_requests WHERE lower(email)=? AND status='approved' ORDER BY reviewed_at DESC LIMIT 1").bind(email).first();
      if(!target)return json({error:'That coach needs an approved coach account first.'},400);
      await db.prepare(`INSERT OR IGNORE INTO team_coaches(team_id,coach_id,role) SELECT ?,?,'assistant' WHERE EXISTS(SELECT 1 FROM team_coaches WHERE team_id=? AND coach_id=? AND role='head')`).bind(teamId,target.id,teamId,coach.id).run();
      return json({success:true});
    }
    await db.prepare(`DELETE FROM team_coaches WHERE team_id=? AND coach_id=? AND role='assistant' AND EXISTS(SELECT 1 FROM team_coaches h WHERE h.team_id=? AND h.coach_id=? AND h.role='head')`).bind(teamId,String(body.coachId||''),teamId,coach.id).run();
    return json({success:true});
  }catch(error){console.error('Shared team messaging:',error);return json({error:'Messaging is unavailable. Please try again.'},503)}
}

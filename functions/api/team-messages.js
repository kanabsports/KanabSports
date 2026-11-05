// Shared coaching-staff inbox. Uses the existing, server-backed coach login.
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
export async function schema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS shared_teams (id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_coaches (team_id TEXT NOT NULL,coach_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('head','assistant')),PRIMARY KEY(team_id,coach_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_messages (id TEXT PRIMARY KEY,team_id TEXT NOT NULL,coach_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS team_messages_team ON team_messages(team_id,created_at,id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_broadcasts (id TEXT PRIMARY KEY,team_id TEXT NOT NULL,coach_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',recipient_count INTEGER NOT NULL DEFAULT 0,sent_count INTEGER NOT NULL DEFAULT 0,failed_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,confirmed_at TEXT,completed_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_broadcast_deliveries (broadcast_id TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(broadcast_id,phone))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sms_enrollment (id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,team TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',step TEXT NOT NULL DEFAULT 'confirm',guardian_name TEXT,player_name TEXT,player_match TEXT,match_status TEXT,consent_started_at TEXT,consented_at TEXT,completed_at TEXT,opted_out_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(phone,team))`)
  ]);
  try{await db.prepare(`ALTER TABLE shared_teams ADD COLUMN sms_team_key TEXT`).run()}catch{}
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
      const connected=await db.prepare('SELECT sms_team_key FROM shared_teams WHERE id=?').bind(teamId).first();
      let recipientCount=0;
      if(connected?.sms_team_key)recipientCount=(await db.prepare(`SELECT count(DISTINCT phone) AS total FROM sms_enrollment WHERE team=? AND status='consented' AND step='complete'`).bind(connected.sms_team_key).first())?.total||0;
      const broadcasts=(await db.prepare(`SELECT b.id,b.body,b.status,b.recipient_count,b.sent_count,b.failed_count,b.created_at,b.completed_at,a.name AS sender FROM team_broadcasts b JOIN coach_access_requests a ON a.id=b.coach_id WHERE b.team_id=? AND b.status!='draft' ORDER BY b.created_at DESC LIMIT 50`).bind(teamId).all()).results;
      return json({coach,teams,staff,messages,older:more?messages[0].sequence:null,parentMessaging:{connected:!!connected?.sms_team_key,recipientCount:Number(recipientCount),sendEnabled:env.TEAM_PARENT_SENDING_ENABLED==='true',broadcasts}});
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
    if(body.action==='preview-parents') {
      const text=String(body.message||'').trim(),id=String(body.messageId||'');
      if(!text||text.length>1200||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Enter a parent message of 1–1,200 characters.'},400);
      const team=await db.prepare('SELECT name,sms_team_key FROM shared_teams WHERE id=?').bind(teamId).first();
      if(!team?.sms_team_key)return json({error:'An administrator must connect this workspace to its parent opt-in list first.'},409);
      const recipients=(await db.prepare(`SELECT count(DISTINCT phone) AS total FROM sms_enrollment WHERE team=? AND status='consented' AND step='complete'`).bind(team.sms_team_key).first())?.total||0;
      if(!recipients)return json({error:'No parents or guardians have completed opt-in for this team.'},409);
      const branded=parentText(team.name,text);
      await db.prepare(`INSERT INTO team_broadcasts(id,team_id,coach_id,body,status,recipient_count) VALUES(?,?,?,?,'draft',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,recipient_count=excluded.recipient_count WHERE team_id=excluded.team_id AND coach_id=excluded.coach_id AND status='draft'`).bind(id,teamId,coach.id,branded,Number(recipients)).run();
      return json({success:true,draftId:id,preview:branded,recipientCount:Number(recipients),sendEnabled:env.TEAM_PARENT_SENDING_ENABLED==='true'});
    }
    if(body.action==='send-parents') {
      if(String(body.confirmation||'')!=='SEND')return json({error:'Confirm the parent message before sending.'},400);
      if(env.TEAM_PARENT_SENDING_ENABLED!=='true')return json({error:'Parent delivery is not enabled yet. Finish Twilio approval before turning it on.'},409);
      if(!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||(!env.TWILIO_MESSAGING_SERVICE_SID&&!env.TWILIO_PHONE_NUMBER))return json({error:'Parent delivery is not configured.'},503);
      const draft=await db.prepare(`SELECT b.id,b.body,t.sms_team_key FROM team_broadcasts b JOIN shared_teams t ON t.id=b.team_id WHERE b.id=? AND b.team_id=? AND b.coach_id=? AND b.status='draft'`).bind(String(body.draftId||''),teamId,coach.id).first();
      if(!draft?.sms_team_key)return json({error:'That preview expired or the parent list is disconnected.'},409);
      const phones=(await db.prepare(`SELECT DISTINCT phone FROM sms_enrollment WHERE team=? AND status='consented' AND step='complete' ORDER BY phone`).bind(draft.sms_team_key).all()).results.map(r=>r.phone);
      if(!phones.length)return json({error:'No currently opted-in recipients.'},409);
      await db.prepare(`UPDATE team_broadcasts SET status='sending',recipient_count=?,confirmed_at=datetime('now') WHERE id=? AND status='draft'`).bind(phones.length,draft.id).run();
      let sent=0,failed=0;
      for(let i=0;i<phones.length;i+=5){
        const results=await Promise.allSettled(phones.slice(i,i+5).map(phone=>twilio(env,phone,draft.body)));
        for(let j=0;j<results.length;j++){const phone=phones[i+j],r=results[j];if(r.status==='fulfilled'){sent++;await db.prepare(`INSERT OR REPLACE INTO team_broadcast_deliveries(broadcast_id,phone,status,provider_id,error,updated_at) VALUES(?,?,'sent',?,NULL,datetime('now'))`).bind(draft.id,phone,r.value).run()}else{failed++;await db.prepare(`INSERT OR REPLACE INTO team_broadcast_deliveries(broadcast_id,phone,status,provider_id,error,updated_at) VALUES(?,?,'failed',NULL,?,datetime('now'))`).bind(draft.id,phone,String(r.reason?.message||'Delivery failed').slice(0,300)).run()}}
      }
      const status=failed?'partial':'sent';
      await db.prepare(`UPDATE team_broadcasts SET status=?,sent_count=?,failed_count=?,completed_at=datetime('now') WHERE id=?`).bind(status,sent,failed,draft.id).run();
      return json({success:true,status,sent,failed});
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
function parentText(team,message){const prefix='Kanab Sports — '+team+': ';const suffix=' Reply STOP to opt out.';const clean=String(message).replace(/\s+/g,' ').trim();return (prefix+clean+suffix).slice(0,1600)}
async function twilio(env,to,body){const form=new URLSearchParams({To:to,Body:body});if(env.TWILIO_MESSAGING_SERVICE_SID)form.set('MessagingServiceSid',env.TWILIO_MESSAGING_SERVICE_SID);else form.set('From',env.TWILIO_PHONE_NUMBER);const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:form});const d=await r.json();if(!r.ok)throw Error(d.message||'Twilio delivery failed');return d.sid}

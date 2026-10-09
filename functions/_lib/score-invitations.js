import {clean} from './coach-auth.js';

// Scope to the canonical team code; legacy accounts remain isolated by coach ID.
export function teamScope(coach){return coach.team_code ? `team:${coach.team_code}` : `coach:${coach.id}`;}
export async function invitationSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_score_assistants(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,
    status TEXT NOT NULL DEFAULT 'pending',trusted INTEGER NOT NULL DEFAULT 0,trust_acknowledged_at TEXT,
    trust_acknowledged_text TEXT,invite_token_hash TEXT,invite_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`).run();
  const columns=(await db.prepare('PRAGMA table_info(coach_score_assistants)').all()).results||[];
  for(const [name,type] of Object.entries({team_scope:'TEXT',provider_message_id:'TEXT',delivery_status:'TEXT',last_error:'TEXT',sent_at:'TEXT',accepted_at:'TEXT',send_attempt:"INTEGER NOT NULL DEFAULT 0"})){
    if(!columns.some(c=>c.name===name))await db.prepare(`ALTER TABLE coach_score_assistants ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare(`UPDATE coach_score_assistants SET team_scope=COALESCE((SELECT CASE WHEN COALESCE(a.team_code,'')<>'' THEN 'team:'||a.team_code ELSE 'coach:'||a.id END FROM coach_access_requests a WHERE a.id=coach_id),'coach:'||coach_id) WHERE team_scope IS NULL`).run();
  await db.prepare(`UPDATE coach_score_assistants SET status='expired',invite_token_hash=NULL WHERE status IN ('pending','sent','accepted','active') AND datetime(invite_expires_at)<=datetime('now')`).run();
  await db.prepare(`UPDATE coach_score_assistants SET status='failed',invite_token_hash=NULL,delivery_status='unconfirmed',last_error='Sending was interrupted; provider acceptance is unconfirmed. Resend the invitation.' WHERE status='pending' AND datetime(updated_at)<datetime('now','-5 minutes')`).run();
  // Historical duplicates do not justify revoking existing access during migration.
  // All new writes use an atomic NOT EXISTS guard, serialized by SQLite.
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_score_invitation_scope ON coach_score_assistants(team_scope,email,status)').run();
}
export async function sendEmail(env,payload,key){
  if(!env.RESEND_API_KEY)return {accepted:false,error:'Email delivery is not configured. The administrator must set RESEND_API_KEY in production.',delivery:'not_configured'};
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:env.SCORE_EMAIL_FROM||env.RESEND_FROM_EMAIL||'Kanab Sports <website@kanabsports.com>',...payload})});
    const data=await response.json().catch(()=>({}));
    if(response.ok && typeof data.id==='string' && data.id)return {accepted:true,id:data.id,delivery:'queued'};
    const code=clean(data.name||data.error?.name,80);
    const errors={validation_error:'The email provider rejected the sender or recipient. Verify the sender domain and email addresses.',restricted_api_key:'The email API key cannot send from this domain.',invalid_api_key:'The email provider rejected its API key.',missing_api_key:'The email provider requires a valid API key.',rate_limit_exceeded:'The email provider is rate limiting requests. Try again shortly.',daily_quota_exceeded:'The email provider daily sending limit has been reached.'};
    return {accepted:false,error:errors[code]||`The email provider did not accept the request (HTTP ${response.status}${code?' · '+code:''}). Ask the administrator to check Resend logs and sender verification.`,delivery:'rejected'};
  }catch{return {accepted:false,error:'The email provider could not be reached or timed out. Acceptance is unconfirmed; use Resend Invitation to retry.',delivery:'unconfirmed'};}
}

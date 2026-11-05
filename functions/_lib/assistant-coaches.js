import {schoolSchema} from './school-access.js';
import {passId} from './travel-pass.js';

export async function assistantCoachSchema(db) {
  await schoolSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_assistant_invites (
    id TEXT PRIMARY KEY, sponsor_id TEXT NOT NULL, team_code TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL,
    token_hash TEXT UNIQUE, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    accepted_coach_id TEXT, provider_message_id TEXT, last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS assistant_invite_email
    ON coach_assistant_invites(team_code,email) WHERE status IN ('sending','sent','accepted')`).run();
  await db.prepare(`UPDATE coach_assistant_invites SET status='expired',token_hash=NULL
    WHERE status='sent' AND datetime(expires_at)<=datetime('now')`).run();
  await db.prepare(`UPDATE coach_assistant_invites SET status='failed',token_hash=NULL,
    last_error='Sending was interrupted. Please resend the invitation.'
    WHERE status='sending' AND datetime(updated_at)<datetime('now','-5 minutes')`).run();
}

// Every grant stays attached to the inviting coach and the same team.
export function activeSponsor() {
  return `s.status='approved' AND lower(s.role) IN ('head coach','coach')
    AND s.team_code=i.team_code
    AND (s.id<>'${passId}' OR s.review_token_hash IS NULL
      OR datetime(s.reviewed_at,'+72 hours')>datetime('now'))`;
}

export async function syncAssistantAccess(db) {
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coach_assistant_invites'").first();
  if(!exists)return;
  const allowed=`SELECT 1 FROM coach_assistant_invites i
    JOIN coach_access_requests s ON s.id=i.sponsor_id
    WHERE i.accepted_coach_id=coach_access_requests.id AND i.status='accepted'
      AND i.team_code=coach_access_requests.team_code AND ${activeSponsor()}`;
  // Explicit owner rejections remain rejected. Only sponsor pauses can resume.
  await db.prepare(`UPDATE coach_access_requests SET status=CASE WHEN EXISTS(${allowed})
    THEN 'approved' ELSE 'assistant_paused' END
    WHERE status IN ('approved','assistant_paused') AND EXISTS(
      SELECT 1 FROM coach_assistant_invites i WHERE i.accepted_coach_id=coach_access_requests.id)
    AND status<>CASE WHEN EXISTS(${allowed}) THEN 'approved' ELSE 'assistant_paused' END`).run();
}

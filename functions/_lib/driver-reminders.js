import {teamPolicy} from './school-access.js';

// A driver assignment survives every reminder attempt and schedule revision.
// Uncertain attempts must retain their provider ID and block replacement sends.
export const BLOCKED_REMINDER_STATES = ['pending', 'scheduled', 'send_unconfirmed', 'cancel_pending', 'cancelling', 'cancel_failed'];
export const BLOCKED_REMINDER_SQL = BLOCKED_REMINDER_STATES.map(s => `'${s}'`).join(',');
export const DRIVER_PLAN_FIELDS = 'id,owner_email,team_code,event_id,driver_name,driver_email,status,remind_at,last_error,review_required,event_cancelled';

export async function driverSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS family_driver_plans(
    id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,team_code TEXT NOT NULL,event_id TEXT NOT NULL,
    driver_name TEXT NOT NULL,driver_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'saved',
    provider_id TEXT,remind_at TEXT,last_error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL
  )`).run();
  const columns = (await db.prepare('PRAGMA table_info(family_driver_plans)').all()).results || [];
  for (const [name, type] of Object.entries({
    reminder_revision: 'INTEGER NOT NULL DEFAULT 0', invalidated_revision: 'INTEGER NOT NULL DEFAULT 0',
    review_required: 'INTEGER NOT NULL DEFAULT 0', event_cancelled: 'INTEGER NOT NULL DEFAULT 0',
    cancel_token: 'TEXT', cancel_started: 'INTEGER'
  })) {
    if (columns.some(c => c.name === name)) continue;
    try { await db.prepare(`ALTER TABLE family_driver_plans ADD COLUMN ${name} ${type}`).run(); }
    catch (error) { if (!/duplicate column name/i.test(String(error?.message))) throw error; }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS family_driver_event ON family_driver_plans(team_code,event_id)').run();
}

// Installed before any schedule write. SQLite runs this in the SAME transaction
// as that write, including the first override. There is no waitUntil invalidation
// gap, and a later worker cannot mark a newer reminder as stale.
export async function driverScheduleTriggers(db) {
  await driverSchema(db);
  for (const operation of ['INSERT', 'UPDATE']) {
    const changed = operation === 'INSERT' ? 'NEW.revision > 0' : `NEW.revision > OLD.revision AND (
      NEW.date <> OLD.date OR NEW.time <> OLD.time OR NEW.title <> OLD.title OR
      NEW.detail <> OLD.detail OR NEW.cancelled <> OLD.cancelled)`;
    await db.prepare(`CREATE TRIGGER IF NOT EXISTS driver_schedule_${operation.toLowerCase()}
      AFTER ${operation} ON team_schedule_changes WHEN ${changed}
      BEGIN
        UPDATE family_driver_plans SET
          invalidated_revision=MAX(invalidated_revision,NEW.revision), event_cancelled=NEW.cancelled,
          review_required=CASE WHEN attempt>0 AND reminder_revision<NEW.revision THEN 1 ELSE review_required END,
          status=CASE WHEN reminder_revision<NEW.revision AND status='scheduled' THEN 'cancel_pending'
                      WHEN reminder_revision<NEW.revision AND status='accepted' THEN 'stale_sent' ELSE status END
        WHERE team_code=NEW.team_code AND event_id=NEW.event_id
          AND EXISTS(SELECT 1 FROM school_teams WHERE team_code=NEW.team_code AND kind IN ('rec','travel') AND school_id IS NULL);
      END`).run();
  }
}

const noRecall = new Set(['sent', 'delivered', 'opened', 'clicked', 'delivery_delayed', 'bounced', 'complained']);
export async function providerDelivery(env, providerId) {
  if (!env.RESEND_API_KEY) return {error: 'Email cancellation is not configured. The old reminder may still arrive.'};
  try {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
      headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`}, signal: AbortSignal.timeout(15000)
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.id === providerId && typeof d.last_event === 'string') return {event: d.last_event};
    return {error: 'Delivery could not be verified. Check provider access and retry; the old reminder may still arrive.'};
  } catch { return {error: 'Delivery could not be verified. The old reminder may still arrive.'}; }
}

async function cancelAtProvider(env, id) {
  if (!env.RESEND_API_KEY) return {status: 'cancel_failed', error: 'Email cancellation is not configured. The old reminder may still arrive.'};
  let error = 'Cancellation is unconfirmed. The old reminder may still arrive. Retry cancellation or check delivery.';
  try {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json'},
      signal: AbortSignal.timeout(15000)
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.id === id) return {status: 'cancelled', error: null};
    error = `Cancellation was not confirmed (HTTP ${r.status}). The old reminder may still arrive. Retry cancellation or check delivery.`;
  } catch { /* A timeout may mean the provider cancelled it; reconcile by ID. */ }
  const delivery = await providerDelivery(env, id);
  if (delivery.event === 'canceled') return {status: 'cancelled', error: null};
  if (noRecall.has(delivery.event)) return {status: 'stale_sent', error: 'The reminder has already entered delivery and cannot be recalled. Contact the driver to confirm the current plan.'};
  if (['failed', 'suppressed'].includes(delivery.event)) return {status: 'failed', error: `Provider reports ${delivery.event}; no replacement has been sent.`};
  return {status: 'cancel_failed', error};
}

export async function cancelDriverReminder(db, env, plan) {
  if (!plan.provider_id) return {ok: false, message: 'Provider acceptance is unresolved. Check the saved status; do not schedule a duplicate reminder.'};
  const token = crypto.randomUUID(), now = Date.now();
  // A lease allows safe recovery if a request is interrupted. Provider-ID and
  // attempt fencing prevent a slow cancellation/check from touching a replacement.
  const claimed = await db.prepare(`UPDATE family_driver_plans SET status='cancelling',cancel_token=?,cancel_started=?
    WHERE id=? AND attempt=? AND provider_id=? AND (status IN ('scheduled','cancel_pending','cancel_failed')
      OR (status='cancelling' AND COALESCE(cancel_started,0)<?)) RETURNING id`)
    .bind(token, now, plan.id, plan.attempt, plan.provider_id, now - 60000).first();
  if (!claimed) return {ok: false, message: 'Cancellation is already running or the reminder changed. Refresh its status.'};
  const result = await cancelAtProvider(env, plan.provider_id);
  const updated = await db.prepare(`UPDATE family_driver_plans SET status=?,last_error=?,cancel_token=NULL,cancel_started=NULL,updated_at=?
    WHERE id=? AND attempt=? AND provider_id=? AND cancel_token=? RETURNING id`)
    .bind(result.status, result.error, new Date().toISOString(), plan.id, plan.attempt, plan.provider_id, token).first();
  return {ok: !!updated && result.status === 'cancelled', message: result.error || 'The provider confirmed cancellation. The driver assignment is saved. Review the current event before authorizing a replacement.'};
}

export async function cancelAffectedDriverReminders(db, env, code, eventId) {
  if (env.PRIVATE_MESSAGING_ENABLED !== 'true') return;
  const policy = await teamPolicy(db, code);
  if (!policy || !['rec','travel'].includes(policy.kind) || policy.school_id) return;
  await driverSchema(db);
  const plans = (await db.prepare(`SELECT * FROM family_driver_plans WHERE team_code=? AND event_id=?
    AND review_required=1 AND status IN ('cancel_pending','cancel_failed','cancelling')`).bind(code, eventId).all()).results || [];
  for (const plan of plans) await cancelDriverReminder(db, env, plan);
}

export async function checkDriverDelivery(db, env, plan) {
  const delivery = await providerDelivery(env, plan.provider_id);
  if (delivery.error) return {ok: false, message: delivery.error};
  const event = delivery.event;
  // A scheduled/queued/unknown response is NOT proof of cancellation. Never
  // demote a cancellation in progress or clear the durable review requirement.
  let status = null, error = null;
  if (event === 'canceled') status = 'cancelled';
  else if (noRecall.has(event)) { status = 'accepted'; error = 'The reminder has entered delivery and cannot be recalled. Confirm current pickup details with the driver.'; }
  else if (['failed','suppressed'].includes(event)) { status = 'failed'; error = `Provider reports ${event}.`; }
  if (status) await db.prepare(`UPDATE family_driver_plans SET status=CASE WHEN ?='accepted' AND review_required=1 THEN 'stale_sent' ELSE ? END,last_error=?,updated_at=?
    WHERE id=? AND attempt=? AND provider_id=? AND status=? AND cancel_token IS ?`)
    .bind(status, status, error, new Date().toISOString(), plan.id, plan.attempt, plan.provider_id, plan.status, plan.cancel_token).run();
  return {ok: true, message: `Provider status: ${event}. ${error || 'Review the current event and reminder status before sending anything else.'}`};
}

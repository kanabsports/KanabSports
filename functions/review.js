export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SPORTS_DB) return page('Review system is not connected yet.', false, 503);
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '');
  const action = String(url.searchParams.get('action') || '').toLowerCase();
  if (!token || !['approve', 'reject', 'confirm-reject', 'feature', 'delete'].includes(action)) return page('This review link is invalid.', false, 400);

  try {
    await ensureSchema(env.SPORTS_DB);
    await cleanupExpiredTests(env.SPORTS_DB);
    const hash = await sha256(token);
    const document = await env.SPORTS_DB.prepare(`SELECT id,name,sport,team,document_type,season,status,review_expires_at,is_test FROM coach_documents WHERE review_token_hash=? LIMIT 1`).bind(hash).first();
    if (document) return reviewDocument(env.SPORTS_DB, document, action, token, url.origin);
    if (action === 'delete') return page('This delete link is invalid or the test has already expired.', false, 404);

    const accessRequest = await env.SPORTS_DB.prepare(`SELECT id,name,email,organization,sport,role,status,review_expires_at FROM coach_access_requests WHERE review_token_hash=? LIMIT 1`).bind(hash).first();
    if (accessRequest) return reviewCoachAccess(env, accessRequest, action, token, url.origin);

    const row = await env.SPORTS_DB.prepare(`SELECT id,type,team,sport,opponent,result,event_date,status,review_expires_at FROM coach_submissions WHERE review_token_hash=? LIMIT 1`).bind(hash).first();
    if (!row) return page('This review link is invalid or has already been used.', false, 404);
    if (row.status !== 'pending') return page(`This submission has already been ${row.status}.`, row.status === 'approved', 409);
    if (!row.review_expires_at || Date.parse(row.review_expires_at) < Date.now()) return page('This review link has expired.', false, 410);
    if (action === 'feature' && row.type !== 'Event') return page('Feature Now is only available for event submissions.', false, 400);
    if (action === 'approve' || action === 'feature') {
      await env.SPORTS_DB.prepare(`UPDATE coach_submissions SET status='approved',featured=?,reviewed_at=datetime('now'),published_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(action === 'feature' ? 1 : 0, row.id).run();
      const label = row.type === 'Score' ? `${row.sport || 'Score'} · ${row.team || 'Team'}${row.result ? ` ${row.result}` : ''}${row.opponent ? ` · ${row.opponent}` : ''}` : `${row.type} · ${row.team || row.sport || 'Submission'}`;
      return page(`${action === 'feature' ? 'Featured now' : 'Published'}: ${label}`, true, 200);
    }
    if (action === 'reject') return denyConfirmation(url.origin, token, `${row.type} · ${row.team || row.sport || 'submission'}`);
    await env.SPORTS_DB.prepare(`UPDATE coach_submissions SET status='rejected',reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(row.id).run();
    return page('Submission denied. Nothing was published.', true, 200);
  } catch (error) {
    console.error(JSON.stringify({ message: 'review error', error: error instanceof Error ? error.message : String(error) }));
    return page('Something went wrong while reviewing this submission.', false, 500);
  }
}

async function reviewCoachAccess(env, request, action, token, origin) {
  if (request.status !== 'pending') return page(`This coach request has already been ${request.status}.`, request.status === 'approved', 409);
  if (!request.review_expires_at || Date.parse(request.review_expires_at) < Date.now()) return page('This coach access link has expired.', false, 410);
  if (action === 'feature' || action === 'delete') return page('That action is not available for coach access requests.', false, 400);
  const label = `Coach access · ${request.name} · ${request.sport}`;
  if (action === 'reject') return denyConfirmation(origin, token, label);
  if (action === 'confirm-reject') {
    await env.SPORTS_DB.prepare(`UPDATE coach_access_requests SET status='rejected',reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(request.id).run();
    return page('Coach access denied. No password was sent.', true, 200);
  }
  if (!env.RESEND_API_KEY || !env.COACH_ACCESS_CODE) return page('The password email is not configured yet, so this request remains pending.', false, 503);
  const uploadUrl = `${origin}/coach-documents.html`;
  const subject = 'Your Kanab Sports coach upload access';
  const text = `Hi ${request.name},\n\nYour coach access request has been approved.\n\nUpload page: ${uploadUrl}\nCoach password: ${env.COACH_ACCESS_CODE}\n\nPlease keep this password within your coaching staff.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:620px"><div style="font-size:12px;font-weight:800;color:#a51420;text-transform:uppercase">Kanab Sports</div><h2>Your coach access is approved</h2><p>Hi ${escapeHtml(request.name)},</p><p>You can now submit a roster, schedule, or MaxPreps link using the coach upload page.</p><p><a href="${escapeHtml(uploadUrl)}" style="display:block;background:#e32636;color:#fff;text-decoration:none;text-align:center;font-size:19px;font-weight:800;padding:17px 22px;border-radius:10px">Open coach upload</a></p><div style="margin-top:20px;padding:16px;background:#f3f3f3;border-radius:9px"><strong>Coach password</strong><br><span style="font-size:22px;letter-spacing:1px">${escapeHtml(env.COACH_ACCESS_CODE)}</span></div><p style="color:#666;font-size:13px">Please keep this password within your coaching staff.</p></div>`;
  const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `coach-access-approved-${request.id}` }, body: JSON.stringify({ from: 'Kanab Sports <website@kanabsports.com>', to: [request.email], subject, text, html }) });
  if (!sent.ok) return page('The coach was verified, but the password email could not be sent. The request remains pending so you can try again.', false, 502);
  await env.SPORTS_DB.prepare(`UPDATE coach_access_requests SET status='approved',reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(request.id).run();
  return page(`Coach approved: ${request.name}`, true, 200, `The upload password was emailed to ${request.email}.`);
}

async function reviewDocument(db, document, action, token, origin) {
  if (!document.review_expires_at || Date.parse(document.review_expires_at) < Date.now()) {
    if (document.is_test) await db.prepare(`DELETE FROM coach_documents WHERE id=?`).bind(document.id).run();
    return page('This review link has expired.', false, 410);
  }
  if (action === 'feature') return page('Private coach documents cannot be featured publicly.', false, 400);
  if (action === 'delete') {
    if (!document.is_test) return page('Only test documents can be deleted with this link.', false, 400);
    await db.prepare(`DELETE FROM coach_documents WHERE id=?`).bind(document.id).run();
    return page('Test document record deleted.', true, 200);
  }
  if (document.status !== 'pending') return page(`This document has already been ${document.status}.`, document.status === 'approved', 409);
  const label = `${document.document_type} · ${document.sport} · ${document.season}`;
  if (action === 'reject') return denyConfirmation(origin, token, label);
  const nextStatus = action === 'approve' ? 'approved' : 'rejected';
  await db.prepare(`UPDATE coach_documents SET status=?,reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(nextStatus, document.id).run();
  let devSlug = null;
  try { devSlug = (await db.prepare(`SELECT slug FROM dev_documents WHERE document_id=? LIMIT 1`).bind(document.id).first())?.slug || null; } catch {}
  return action === 'approve'
    ? page(`Approved: ${label}`, true, 200, devSlug ? 'The development preview is now live.' : 'The PDF remains private.', devSlug ? '/dev-coach-documents.html' : '/', devSlug ? 'View development preview' : 'Back to Kanab Sports')
    : page(`Denied: ${label}`, true, 200, 'Nothing was published.');
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_submissions (id TEXT PRIMARY KEY,source TEXT NOT NULL,type TEXT NOT NULL,name TEXT,email TEXT,team TEXT,sport TEXT,event_date TEXT,opponent TEXT,result TEXT,link TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  try { await db.prepare(`ALTER TABLE coach_submissions ADD COLUMN featured INTEGER NOT NULL DEFAULT 0`).run(); } catch {}
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_documents (id TEXT PRIMARY KEY,verification_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,document_type TEXT NOT NULL,season TEXT NOT NULL,notes TEXT,filename TEXT NOT NULL,byte_size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER NOT NULL DEFAULT 0,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_access_requests (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,organization TEXT NOT NULL,sport TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,team_url TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function cleanupExpiredTests(db) {
  await db.prepare(`DELETE FROM coach_documents WHERE is_test=1 AND test_expires_at IS NOT NULL AND datetime(test_expires_at)<=datetime('now')`).run();
}

async function sha256(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function page(message, success, status, detail = 'You can close this page when you’re finished.', href = '/', buttonLabel = 'Back to Kanab Sports') {
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kanab Sports Review</title><style>body{margin:0;background:#0b0c0f;color:white;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 32px));background:#15171b;border:1px solid #2d3036;border-radius:18px;padding:32px}.brand{font-weight:950;font-size:24px;margin-bottom:24px}.brand span{color:#e32636}.badge{display:inline-block;padding:8px 11px;border-radius:999px;background:${success ? '#123d20' : '#44191d'};color:${success ? '#86e39c' : '#ff9ba4'};font-size:12px;font-weight:900;text-transform:uppercase}h1{font-size:32px;line-height:1.05;margin:16px 0 10px}p{color:#b9bcc4}.button{display:inline-block;margin-top:18px;background:#e32636;color:white;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:9px}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="badge">${success ? 'Done' : 'Needs attention'}</div><h1>${escapeHtml(message)}</h1><p>${escapeHtml(detail)}</p><a class="button" href="${escapeHtml(href)}">${escapeHtml(buttonLabel)}</a></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function denyConfirmation(origin, token, label) {
  const href=`${origin}/review?token=${encodeURIComponent(token)}&action=confirm-reject`;
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm denial · Kanab Sports</title><style>body{margin:0;background:#0b0c0f;color:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 32px));background:#15171b;border:1px solid #2d3036;border-radius:18px;padding:32px}.brand{font-weight:950;font-size:24px;margin-bottom:24px}.brand span{color:#e32636}h1{font-size:32px;line-height:1.05;margin:12px 0}p{color:#b9bcc4}.cancel,.deny{display:block;text-align:center;text-decoration:none;font-weight:900;padding:15px 18px;border-radius:9px}.cancel{background:#16833a;color:#fff;margin-top:24px;font-size:18px}.deny{color:#ff9ba4;border:1px solid #6b2a30;margin-top:26px;font-size:13px}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><h1>Did you mean to deny this?</h1><p>${escapeHtml(label)}</p><a class="cancel" href="/">No — keep it pending</a><a class="deny" href="${escapeHtml(href)}">Yes, deny this submission</a></main></body></html>`,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }

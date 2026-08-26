const MAX_PDF_BYTES = 5 * 1024 * 1024;
const ADMIN_EMAIL = 'howdy@kanabsports.com';

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SPORTS_DB || !env.RESEND_API_KEY) {
    return json({ success: false, error: 'Coach document uploads are not configured yet.' }, 503);
  }

  try {
    await ensureSchema(env.SPORTS_DB);
    await cleanupExpiredTests(env.SPORTS_DB);

    if (request.method === 'GET') return inspectVerification(request, env);
    if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

    const form = await request.formData();
    const action = clean(form.get('action'), 40);
    if (action === 'request-verification') return requestVerification(request, env, form);
    if (action === 'upload') return uploadDocument(request, env, form);
    return json({ success: false, error: 'Invalid request.' }, 400);
  } catch (error) {
    console.error(JSON.stringify({ message: 'coach document error', error: error instanceof Error ? error.message : String(error) }));
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function requestVerification(request, env, form) {
  if (clean(form.get('website'), 100)) return json({ success: true });
  const turnstile = clean(form.get('cf-turnstile-response'), 3000);
  if (!turnstile) return json({ success: false, error: 'Please wait for verification to finish.' }, 400);
  if (!env.TURNSTILE_SECRET_KEY) return json({ success: false, error: 'Verification is not configured.' }, 503);
  if (!(await verifyTurnstile(request, env.TURNSTILE_SECRET_KEY, turnstile))) {
    return json({ success: false, error: 'Human verification failed. Please refresh and try again.' }, 403);
  }

  const name = clean(form.get('name'), 120);
  const email = clean(form.get('email'), 180).toLowerCase();
  const sport = clean(form.get('sport'), 120);
  const team = clean(form.get('team'), 180);
  if (!name || !validEmail(email) || !sport || !team) {
    return json({ success: false, error: 'Please complete your name, email, sport, and team.' }, 400);
  }

  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await env.SPORTS_DB.prepare(`
    INSERT INTO coach_document_verifications
      (id,token_hash,email,name,sport,team,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))
  `).bind(id, tokenHash, email, name, sport, team, expires).run();

  const origin = new URL(request.url).origin;
  const verifyUrl = `${origin}/coach-documents.html?token=${encodeURIComponent(token)}`;
  const subject = 'Verify your email to upload a coach document';
  const text = `Hi ${name},\n\nOpen this secure link to upload a PDF roster, schedule, or combined document:\n${verifyUrl}\n\nThe link expires in 30 minutes. If you did not request it, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:620px"><h2>Verify your coach email</h2><p>Hi ${escapeHtml(name)},</p><p>Use the button below to upload a PDF roster, schedule, or combined document.</p><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#e32636;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Verify email &amp; upload PDF</a></p><p style="color:#666;font-size:13px">This link expires in 30 minutes. If you did not request it, you can ignore this email.</p></div>`;
  const sent = await sendEmail(env.RESEND_API_KEY, { from: 'Kanab Sports <website@kanabsports.com>', to: [email], reply_to: ADMIN_EMAIL, subject, text, html }, `coach-verify-${id}`);
  if (!sent) {
    await env.SPORTS_DB.prepare(`DELETE FROM coach_document_verifications WHERE id=?`).bind(id).run();
    return json({ success: false, error: 'We could not send the verification email. Please try again.' }, 502);
  }
  return json({ success: true, message: 'Check your email for the secure upload link.' });
}

async function inspectVerification(request, env) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return json({ success: false, error: 'Verification link is missing.' }, 400);
  const row = await findVerification(env.SPORTS_DB, token);
  if (!row) return json({ success: false, error: 'This verification link is invalid, expired, or already used.' }, 410);
  return json({ success: true, coach: { name: row.name, email: row.email, sport: row.sport, team: row.team } });
}

async function uploadDocument(request, env, form) {
  const token = clean(form.get('token'), 200);
  const row = await findVerification(env.SPORTS_DB, token);
  if (!row) return json({ success: false, error: 'This verification link is invalid, expired, or already used.' }, 410);

  const documentType = clean(form.get('document_type'), 80);
  const season = clean(form.get('season'), 100);
  const notes = clean(form.get('notes'), 1500);
  const isTest = String(form.get('is_test') || '').toLowerCase() === 'yes';
  const allowed = new Set(['Roster', 'Schedule', 'Roster and schedule']);
  if (!allowed.has(documentType) || !season) return json({ success: false, error: 'Choose the document type and enter the season.' }, 400);

  const file = form.get('pdf');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.name) return json({ success: false, error: 'Choose a PDF to upload.' }, 400);
  if (file.size < 5 || file.size > MAX_PDF_BYTES) return json({ success: false, error: 'The PDF must be 5 MB or smaller.' }, 413);
  if (file.type && file.type !== 'application/pdf') return json({ success: false, error: 'Only PDF files are accepted.' }, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return json({ success: false, error: 'That file does not appear to be a valid PDF.' }, 415);

  const reserved = await env.SPORTS_DB.prepare(`UPDATE coach_document_verifications SET used_at=datetime('now') WHERE id=? AND used_at IS NULL`).bind(row.id).run();
  if (!reserved.meta?.changes) return json({ success: false, error: 'This verification link has already been used.' }, 409);

  const id = crypto.randomUUID();
  const reviewToken = randomToken();
  const reviewHash = await sha256(reviewToken);
  const reviewExpires = new Date(Date.now() + (isTest ? 5 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)).toISOString();
  const testExpires = isTest ? reviewExpires : null;
  const filename = safeFilename(file.name);
  await env.SPORTS_DB.prepare(`
    INSERT INTO coach_documents
      (id,verification_id,name,email,sport,team,document_type,season,notes,filename,byte_size,status,review_token_hash,review_expires_at,is_test,test_expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,datetime('now'))
  `).bind(id, row.id, row.name, row.email, row.sport, row.team, documentType, season, notes, filename, bytes.byteLength, reviewHash, reviewExpires, isTest ? 1 : 0, testExpires).run();

  const origin = new URL(request.url).origin;
  const approve = `${origin}/review?token=${encodeURIComponent(reviewToken)}&action=approve`;
  const reject = `${origin}/review?token=${encodeURIComponent(reviewToken)}&action=reject`;
  const deleteTest = isTest ? `${origin}/review?token=${encodeURIComponent(reviewToken)}&action=delete` : '';
  const kind = documentType.toLowerCase();
  const recap = `Verified email — Coach ${row.name} uploaded ${article(kind)} ${kind} for ${season}.`;
  const subject = `${isTest ? 'TEST — ' : ''}Verified coach document — ${row.name} — ${row.sport}`;
  const rows = [
    ['Status', 'Email verified'], ['Coach', row.name], ['Email', row.email], ['Sport', row.sport], ['Team', row.team],
    ['Document', documentType], ['Season', season], ['File', filename], ['Test', isTest ? 'Yes — expires in 5 minutes' : 'No']
  ];
  const text = `${recap}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}${notes ? `\n\nNotes: ${notes}` : ''}\n\nApprove: ${approve}\nDeny: ${reject}${deleteTest ? `\nDelete test: ${deleteTest}` : ''}`;
  const htmlRows = rows.map(([label, value]) => `<tr><td style="padding:6px 14px 6px 0;font-weight:700">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:680px"><h2>${escapeHtml(recap)}</h2><table style="border-collapse:collapse;margin:18px 0">${htmlRows}</table>${notes ? `<div style="padding:14px;background:#f5f5f5;border-radius:8px"><strong>Notes</strong><br>${escapeHtml(notes)}</div>` : ''}<div style="margin-top:22px"><a href="${escapeHtml(approve)}" style="display:inline-block;background:#16833a;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;margin-right:8px">Approve</a><a href="${escapeHtml(reject)}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Deny</a>${deleteTest ? `<a href="${escapeHtml(deleteTest)}" style="display:inline-block;color:#a00;font-weight:700;padding:12px">Delete test</a>` : ''}</div><p style="color:#666;font-size:12px">The PDF is attached and remains private; it is never published automatically.</p></div>`;
  const payload = { from: 'Kanab Sports <website@kanabsports.com>', to: [ADMIN_EMAIL], reply_to: row.email, subject, text, html, attachments: [{ filename, content: toBase64(bytes) }] };
  const sent = await sendEmail(env.RESEND_API_KEY, payload, `coach-document-${id}`);
  if (!sent) {
    await env.SPORTS_DB.batch([
      env.SPORTS_DB.prepare(`DELETE FROM coach_documents WHERE id=?`).bind(id),
      env.SPORTS_DB.prepare(`UPDATE coach_document_verifications SET used_at=NULL WHERE id=?`).bind(row.id),
    ]);
    return json({ success: false, error: 'The PDF could not be delivered. Please try again.' }, 502);
  }
  return json({ success: true, message: isTest ? 'Test PDF sent. Its review link expires in 5 minutes.' : 'PDF sent to Kanab Sports for approval.' });
}

async function findVerification(db, token) {
  if (!token) return null;
  const hash = await sha256(token);
  return db.prepare(`SELECT id,email,name,sport,team,expires_at,used_at FROM coach_document_verifications WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1`).bind(hash).first();
}

async function verifyTurnstile(request, secret, response) {
  const body = new URLSearchParams({ secret, response });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!result.ok) return false;
  const data = await result.json();
  return Boolean(data.success);
}

async function sendEmail(apiKey, payload, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload) });
  if (!response.ok) console.error(JSON.stringify({ message: 'email delivery failed', status: response.status }));
  return response.ok;
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_document_verifications (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,email TEXT NOT NULL,name TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_documents (id TEXT PRIMARY KEY,verification_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,document_type TEXT NOT NULL,season TEXT NOT NULL,notes TEXT,filename TEXT NOT NULL,byte_size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER NOT NULL DEFAULT 0,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function cleanupExpiredTests(db) {
  await db.prepare(`DELETE FROM coach_documents WHERE is_test=1 AND test_expires_at IS NOT NULL AND datetime(test_expires_at)<=datetime('now')`).run();
  await db.prepare(`DELETE FROM coach_document_verifications WHERE used_at IS NULL AND datetime(expires_at)<=datetime('now','-1 day')`).run();
}

function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(24)); return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
async function sha256(value) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join(''); }
function toBase64(bytes) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); }
function safeFilename(value) { const cleaned = String(value).replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120); return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned || 'coach-document'}.pdf`; }
function article(value) { return /^[aeiou]/i.test(value) ? 'an' : 'a'; }
function clean(value, max = 500) { return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }

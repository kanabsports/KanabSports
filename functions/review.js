export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SPORTS_DB) return page('Review system is not connected yet.', false, 503);

  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '');
  const action = String(url.searchParams.get('action') || '').toLowerCase();
  if (!token || !['approve', 'reject'].includes(action)) return page('This review link is invalid.', false, 400);

  try {
    await ensureSchema(env.SPORTS_DB);
    const tokenHash = await sha256(token);
    const row = await env.SPORTS_DB.prepare(`
      SELECT id, type, team, sport, opponent, result, event_date, status, review_expires_at
      FROM coach_submissions WHERE review_token_hash = ? LIMIT 1
    `).bind(tokenHash).first();

    if (!row) return page('This review link is invalid or has already been used.', false, 404);
    if (row.status !== 'pending') return page(`This submission has already been ${row.status}.`, row.status === 'approved', 409);
    if (!row.review_expires_at || Date.parse(row.review_expires_at) < Date.now()) {
      return page('This review link has expired.', false, 410);
    }

    if (action === 'approve') {
      await env.SPORTS_DB.prepare(`
        UPDATE coach_submissions
        SET status='approved', reviewed_at=datetime('now'), published_at=datetime('now'), review_token_hash=NULL
        WHERE id=? AND status='pending'
      `).bind(row.id).run();
      const label = row.type === 'Score'
        ? `${row.sport || 'Score'} · ${row.team || 'Team'}${row.result ? ` ${row.result}` : ''}${row.opponent ? ` · ${row.opponent}` : ''}`
        : `${row.type} · ${row.team || row.sport || 'Submission'}`;
      return page(`Published: ${label}`, true, 200);
    }

    await env.SPORTS_DB.prepare(`
      UPDATE coach_submissions
      SET status='rejected', reviewed_at=datetime('now'), review_token_hash=NULL
      WHERE id=? AND status='pending'
    `).bind(row.id).run();
    return page('Submission rejected. Nothing was published.', true, 200);
  } catch (error) {
    console.error('Review error', error);
    return page('Something went wrong while reviewing this submission.', false, 500);
  }
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS coach_submissions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, name TEXT, email TEXT,
      team TEXT, sport TEXT, event_date TEXT, opponent TEXT, result TEXT, link TEXT, message TEXT,
      status TEXT NOT NULL DEFAULT 'pending', review_token_hash TEXT, review_expires_at TEXT,
      reviewed_at TEXT, published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function page(message, success, status) {
  const safe = escapeHtml(message);
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kanab Sports Review</title><style>body{margin:0;background:#0b0c0f;color:white;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 32px));background:#15171b;border:1px solid #2d3036;border-radius:18px;padding:32px}.brand{font-weight:950;font-size:24px;margin-bottom:24px}.brand span{color:#e32636}.badge{display:inline-block;padding:8px 11px;border-radius:999px;background:${success ? '#123d20' : '#44191d'};color:${success ? '#86e39c' : '#ff9ba4'};font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.8px}h1{font-size:32px;line-height:1.05;margin:16px 0 10px}p{color:#b9bcc4;line-height:1.5}.button{display:inline-block;margin-top:18px;background:#e32636;color:white;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:9px}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="badge">${success ? 'Done' : 'Needs attention'}</div><h1>${safe}</h1><p>You can close this page when you’re finished.</p><a class="button" href="/">Back to Kanab Sports</a></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

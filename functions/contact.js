export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const form = await request.formData();
    const turnstileToken = form.get('cf-turnstile-response');
    const honeypot = String(form.get('website') || '').trim();

    if (honeypot) return json({ success: true });

    if (!turnstileToken || !env.TURNSTILE_SECRET_KEY) {
      return json({ success: false, error: 'Verification is unavailable. Please try again.' }, 400);
    }
    if (!env.RESEND_API_KEY) {
      return json({ success: false, error: 'Email delivery is unavailable. Please try again.' }, 500);
    }

    const verifyBody = new URLSearchParams();
    verifyBody.set('secret', env.TURNSTILE_SECRET_KEY);
    verifyBody.set('response', turnstileToken);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) verifyBody.set('remoteip', ip);

    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyBody,
    });
    const verification = await verifyResponse.json();
    if (!verification.success) {
      return json({ success: false, error: 'Human verification failed. Please try again.' }, 403);
    }

    const clean = (value, max = 1500) => String(value || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim()
      .slice(0, max);

    const type = clean(form.get('type'), 100) || 'General question';
    const source = clean(form.get('source'), 80) || 'Contact form';
    const name = clean(form.get('name'), 120);
    const email = clean(form.get('email'), 180);
    const team = clean(form.get('team'), 180);
    const sport = clean(form.get('sport'), 120);
    const date = clean(form.get('date'), 80);
    const opponent = clean(form.get('opponent'), 180);
    const result = clean(form.get('result'), 180);
    const link = clean(form.get('link'), 600);
    const message = clean(form.get('message'), 3000);

    if (!name || !email || !message || !email.includes('@')) {
      return json({ success: false, error: 'Please complete your name, email, and message.' }, 400);
    }

    let review = null;
    if (source === 'Coaches' && env.SPORTS_DB) {
      try {
        await ensureSchema(env.SPORTS_DB);
        const id = crypto.randomUUID();
        const reviewToken = randomToken();
        const tokenHash = await sha256(reviewToken);
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.SPORTS_DB.prepare(`
          INSERT INTO submissions
          (id, source, type, name, email, team, sport, event_date, opponent, result, link, message, status, review_token_hash, review_expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
        `).bind(id, source, type, name, email, team, sport, date, opponent, result, link, message, tokenHash, expires).run();
        review = { id, token: reviewToken };
      } catch (dbError) {
        console.error('Submission storage error', dbError);
      }
    }

    const subjectPrefix = source === 'Coaches' ? 'Coach submission' : 'Kanab Sports';
    const subject = `${subjectPrefix} — ${type}${sport ? ` — ${sport}` : ''}`;
    const rows = [
      ['Submission', type], ['Submitted by', name], ['Email', email], ['Team / Organization', team],
      ['Sport', sport], ['Date', date], ['Opponent / Event', opponent], ['Score / Result', result], ['Link', link],
    ].filter(([, value]) => value);

    const origin = new URL(request.url).origin;
    const approveUrl = review ? `${origin}/review?token=${encodeURIComponent(review.token)}&action=approve` : '';
    const rejectUrl = review ? `${origin}/review?token=${encodeURIComponent(review.token)}&action=reject` : '';
    const reviewText = review ? `\nReview: ${approveUrl}\nReject: ${rejectUrl}\n` : '';
    const text = [...rows.map(([label, value]) => `${label}: ${value}`), '', message, reviewText].join('\n');

    const htmlRows = rows.map(([label, value]) =>
      `<tr><td style="padding:6px 14px 6px 0;font-weight:700;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top">${escapeHtml(value)}</td></tr>`
    ).join('');
    const reviewButtons = review ? `
      <div style="margin-top:24px;padding-top:22px;border-top:1px solid #e5e5e5">
        <div style="font-weight:700;margin-bottom:12px">Publish this submission?</div>
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#16833a;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;margin-right:8px">✓ Approve & Publish</a>
        <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Reject</a>
        <div style="color:#777;font-size:12px;margin-top:10px">Review links expire in 7 days and can only be used once.</div>
      </div>` : '';

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:680px">
        <h2 style="margin:0 0 18px">${source === 'Coaches' ? 'New Coaches submission' : 'New Kanab Sports submission'}</h2>
        <table style="border-collapse:collapse;margin-bottom:22px">${htmlRows}</table>
        <div style="padding:16px 18px;background:#f5f5f5;border-radius:10px;white-space:pre-wrap">${escapeHtml(message)}</div>
        ${reviewButtons}
      </div>`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kanab Sports <website@kanabsports.com>',
        to: ['howdy@kanabsports.com'],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });

    if (!resendResponse.ok) {
      let detail = '';
      try { detail = (await resendResponse.json())?.message || ''; } catch {}
      console.error('Resend error', resendResponse.status, detail);
      return json({ success: false, error: 'We could not send your message. Please try again.' }, 502);
    }

    return json({ success: true, reviewReady: Boolean(review) });
  } catch (error) {
    console.error('Contact form error', error);
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}

export function onRequestGet() {
  return json({ success: false, error: 'Method not allowed.' }, 405);
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      email TEXT,
      team TEXT,
      sport TEXT,
      event_date TEXT,
      opponent TEXT,
      result TEXT,
      link TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      review_token_hash TEXT,
      review_expires_at TEXT,
      reviewed_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_status_type ON submissions(status, type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_published ON submissions(published_at)').run();
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

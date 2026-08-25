export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const form = await request.formData();
    const token = form.get('cf-turnstile-response');
    const honeypot = String(form.get('website') || '').trim();

    if (honeypot) return json({ success: true });

    if (!token || !env.TURNSTILE_SECRET_KEY) {
      return json({ success: false, error: 'Verification is unavailable. Please try again.' }, 400);
    }

    if (!env.RESEND_API_KEY) {
      return json({ success: false, error: 'Email delivery is unavailable. Please try again.' }, 500);
    }

    const verifyBody = new URLSearchParams();
    verifyBody.set('secret', env.TURNSTILE_SECRET_KEY);
    verifyBody.set('response', token);
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

    const subjectPrefix = source === 'Coaches' ? 'Coach submission' : 'Kanab Sports';
    const subject = `${subjectPrefix} — ${type}${sport ? ` — ${sport}` : ''}`;

    const rows = [
      ['Submission', type],
      ['Submitted by', name],
      ['Email', email],
      ['Team / Organization', team],
      ['Sport', sport],
      ['Date', date],
      ['Opponent / Event', opponent],
      ['Score / Result', result],
      ['Link', link],
    ].filter(([, value]) => value);

    const text = [
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      message,
    ].join('\n');

    const htmlRows = rows.map(([label, value]) =>
      `<tr><td style="padding:6px 14px 6px 0;font-weight:700;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top">${escapeHtml(value)}</td></tr>`
    ).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:680px">
        <h2 style="margin:0 0 18px">${source === 'Coaches' ? 'New Coaches submission' : 'New Kanab Sports submission'}</h2>
        <table style="border-collapse:collapse;margin-bottom:22px">${htmlRows}</table>
        <div style="padding:16px 18px;background:#f5f5f5;border-radius:10px;white-space:pre-wrap">${escapeHtml(message)}</div>
      </div>`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
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
      try {
        const errorData = await resendResponse.json();
        detail = errorData?.message || '';
      } catch {}
      console.error('Resend error', resendResponse.status, detail);
      return json({ success: false, error: 'We could not send your message. Please try again.' }, 502);
    }

    return json({ success: true });
  } catch (error) {
    console.error('Contact form error', error);
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}

export function onRequestGet() {
  return json({ success: false, error: 'Method not allowed.' }, 405);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

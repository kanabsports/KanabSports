export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const form = await request.formData();
    const token = form.get('cf-turnstile-response');
    const honeypot = String(form.get('website') || '').trim();

    if (honeypot) {
      return json({ success: true });
    }

    if (!token || !env.TURNSTILE_SECRET_KEY) {
      return json({ success: false, error: 'Verification is unavailable. Please try again.' }, 400);
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

    const clean = (value, max = 1500) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
    const type = clean(form.get('type'), 80) || 'General question';
    const name = clean(form.get('name'), 120);
    const email = clean(form.get('email'), 180);
    const team = clean(form.get('team'), 180);
    const sport = clean(form.get('sport'), 120);
    const message = clean(form.get('message'), 2500);

    if (!name || !email || !message || !email.includes('@')) {
      return json({ success: false, error: 'Please complete your name, email, and message.' }, 400);
    }

    const subject = `Kanab Sports — ${type}${sport ? ` — ${sport}` : ''}`;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Type: ${type}`,
      team ? `Team / Organization: ${team}` : '',
      sport ? `Sport: ${sport}` : '',
      '',
      message,
    ].filter(Boolean).join('\n');

    const mailto = `mailto:howdy@kanabsports.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return json({ success: true, mailto });
  } catch (error) {
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}

export function onRequestGet() {
  return json({ success: false, error: 'Method not allowed.' }, 405);
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

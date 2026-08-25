export async function onRequestGet(context) {
  const { env } = context;
  if (!env.SPORTS_DB) return json({ events: [] });

  try {
    await ensureSchema(env.SPORTS_DB);
    const query = await env.SPORTS_DB.prepare(`
      SELECT id, team, sport, event_date, opponent, result, link, message, published_at
      FROM coach_submissions
      WHERE status='approved'
        AND type='Event'
        AND (event_date IS NULL OR event_date='' OR date(event_date) >= date('now'))
      ORDER BY CASE WHEN event_date IS NULL OR event_date='' THEN 1 ELSE 0 END, date(event_date) ASC, datetime(published_at) DESC
      LIMIT 12
    `).all();

    return json({ events: (query.results || []).map(row => ({
      id: row.id,
      team: row.team || '',
      sport: row.sport || '',
      date: row.event_date || '',
      name: row.opponent || row.team || row.sport || 'Community sports event',
      details: row.message || row.result || '',
      meta: row.result || '',
      link: row.link || ''
    })) });
  } catch (error) {
    console.error('Events API error', error);
    return json({ events: [] });
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

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate'}
  });
}

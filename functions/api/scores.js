export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SPORTS_DB) {
    return json({ scores: [] });
  }

  try {
    await ensureSchema(env.SPORTS_DB);
    const query = await env.SPORTS_DB.prepare(`
      SELECT id, sport, team, opponent, result, event_date, published_at
      FROM submissions
      WHERE status='approved'
        AND type='Score'
        AND datetime(COALESCE(published_at, created_at)) >= datetime('now', '-14 days')
      ORDER BY datetime(COALESCE(event_date, published_at, created_at)) DESC
      LIMIT 20
    `).all();

    const scores = (query.results || []).map(row => normalizeScore(row)).filter(Boolean);
    return json({ scores });
  } catch (error) {
    console.error('Scores API error', error);
    return json({ scores: [] });
  }
}

function normalizeScore(row) {
  const parsed = parseScores(row.result || '');
  return {
    id: row.id,
    sport: row.sport || 'Sport',
    team: compactTeam(row.team || 'Kanab'),
    opponent: row.opponent || 'Opponent',
    teamScore: parsed?.teamScore ?? null,
    opponentScore: parsed?.opponentScore ?? null,
    result: row.result || '',
    status: 'FINAL',
    date: row.event_date || String(row.published_at || '').slice(0, 10),
  };
}

function parseScores(value) {
  const nums = String(value).match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  return { teamScore: Number(nums[0]), opponentScore: Number(nums[1]) };
}

function compactTeam(value) {
  return String(value)
    .replace(/^travel\s+/i, '')
    .replace(/^kanab\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Kanab';
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, name TEXT, email TEXT,
      team TEXT, sport TEXT, event_date TEXT, opponent TEXT, result TEXT, link TEXT, message TEXT,
      status TEXT NOT NULL DEFAULT 'pending', review_token_hash TEXT, review_expires_at TEXT,
      reviewed_at TEXT, published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

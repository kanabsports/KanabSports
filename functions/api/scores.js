export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SPORTS_DB) {
    return json({ scores: [], celebration: null });
  }

  try {
    await ensureSchema(env.SPORTS_DB);

    // One-time cleanup for the temporary State Champs test submission.
    await env.SPORTS_DB.prepare(`
      DELETE FROM coach_submissions
      WHERE type='Score'
        AND lower(trim(team))='cowgirls'
        AND lower(trim(opponent))='beaver'
        AND replace(replace(trim(result), ' ', ''), '—', '-') IN ('7-3','7–3')
        AND lower(trim(message))='state champs'
    `).run();

    const query = await env.SPORTS_DB.prepare(`
      SELECT id, sport, team, opponent, result, event_date, message, published_at, created_at
      FROM coach_submissions
      WHERE status='approved'
        AND type='Score'
        AND datetime(COALESCE(published_at, created_at)) >= datetime('now', '-14 days')
      ORDER BY datetime(COALESCE(event_date, published_at, created_at)) DESC
      LIMIT 20
    `).all();

    const rows = query.results || [];
    const scores = rows.map(row => normalizeScore(row)).filter(Boolean);

    const championRow = rows
      .filter(row => /\bstate\s+champs?\b/i.test(String(row.message || '')))
      .filter(row => {
        const published = Date.parse(String(row.published_at || row.created_at || ''));
        return Number.isFinite(published) && (Date.now() - published) <= 24 * 60 * 60 * 1000;
      })
      .sort((a, b) => Date.parse(String(b.published_at || b.created_at || '')) - Date.parse(String(a.published_at || a.created_at || '')))[0];

    const celebration = championRow ? normalizeCelebration(championRow) : null;
    return json({ scores, celebration });
  } catch (error) {
    console.error('Scores API error', error);
    return json({ scores: [], celebration: null });
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

function normalizeCelebration(row) {
  const parsed = parseScores(row.result || '');
  return {
    id: row.id,
    sport: row.sport || 'Sport',
    team: compactTeam(row.team || 'Kanab'),
    opponent: row.opponent || '',
    teamScore: parsed?.teamScore ?? null,
    opponentScore: parsed?.opponentScore ?? null,
    publishedAt: row.published_at || row.created_at || '',
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
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

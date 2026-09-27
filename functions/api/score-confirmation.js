const PROVIDERS = {
  football: { label: 'Football', season: 'Fall', sid: '1', sport: 'Football' },
  'girls soccer': { label: 'Girls Soccer', season: 'Fall', sid: '2', sport: 'Soccer' },
  soccer: { label: 'Girls Soccer', season: 'Fall', sid: '2', sport: 'Soccer' },
  'girls volleyball': { label: 'Girls Volleyball', season: 'Fall', sid: '2', sport: 'Volleyball' },
  volleyball: { label: 'Girls Volleyball', season: 'Fall', sid: '2', sport: 'Volleyball' },
  'boys basketball': { label: 'Boys Basketball', season: 'Winter', sid: '1', sport: 'Basketball' },
  'girls basketball': { label: 'Girls Basketball', season: 'Winter', sid: '2', sport: 'Basketball' },
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requested = parseRequest(url.searchParams);

  if (requested.error) {
    return json({ status: 'invalid_request', error: requested.error }, 400);
  }

  const provider = PROVIDERS[requested.sportKey];
  if (!provider) {
    return json({
      status: 'unsupported_sport',
      provider: 'UHSAA',
      sport: requested.sport,
      supportedSports: [...new Set(Object.values(PROVIDERS).map(item => item.label))],
    }, 400);
  }

  const sourceUrl = buildUhsaaUrl(requested.date, provider);
  const enabled = String(env.UHSAA_CONFIRMATION_ENABLED || '').toLowerCase() === 'true';

  // Important: this integration is intentionally opt-in. UHSAA publishes these
  // scores publicly, but Kanab Sports should not automate retrieval until UHSAA /
  // MaxPreps confirms that this usage is permitted or provides an approved feed.
  if (!enabled) {
    return json({
      status: 'disabled_pending_permission',
      provider: 'UHSAA',
      confirmationEnabled: false,
      sourceUrl,
      requested: publicRequest(requested),
      note: 'Set UHSAA_CONFIRMATION_ENABLED=true only after data-use permission or an approved feed is confirmed.',
    });
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'KanabSports/1.0 (score confirmation; contact howdy@kanabsports.com)',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 3600,
      },
    });

    if (!response.ok) {
      return json({
        status: 'provider_error',
        provider: 'UHSAA',
        sourceUrl,
        upstreamStatus: response.status,
      }, 502);
    }

    const html = await response.text();
    const match = findGame(html, requested);

    return json({
      ...match,
      provider: 'UHSAA',
      sourceUrl,
      checkedAt: new Date().toISOString(),
      requested: publicRequest(requested),
    });
  } catch (error) {
    console.error('UHSAA score confirmation error', error);
    return json({
      status: 'provider_error',
      provider: 'UHSAA',
      sourceUrl,
      error: 'Unable to check the score provider.',
    }, 502);
  }
}

function parseRequest(params) {
  const date = String(params.get('date') || '').trim();
  const sport = String(params.get('sport') || '').trim();
  const team = String(params.get('team') || '').trim();
  const opponent = String(params.get('opponent') || '').trim();
  const teamScoreRaw = String(params.get('teamScore') || '').trim();
  const opponentScoreRaw = String(params.get('opponentScore') || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date must use YYYY-MM-DD.' };
  }
  if (!sport || !team || !opponent) {
    return { error: 'sport, team, and opponent are required.' };
  }
  if (!/^\d+$/.test(teamScoreRaw) || !/^\d+$/.test(opponentScoreRaw)) {
    return { error: 'teamScore and opponentScore must be non-negative integers.' };
  }

  return {
    date,
    sport,
    sportKey: normalizeSport(sport),
    team,
    opponent,
    teamScore: Number(teamScoreRaw),
    opponentScore: Number(opponentScoreRaw),
  };
}

function buildUhsaaUrl(date, provider) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new URL('https://uhsaa.org/scores/');
  target.searchParams.set('date', `${month}_${day}_${year}`);
  target.searchParams.set('season', provider.season);
  target.searchParams.set('sid', provider.sid);
  target.searchParams.set('sport', provider.sport);
  return target.toString();
}

function findGame(html, requested) {
  const rows = String(html).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  let foundTeams = null;

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(match => cleanCell(match[1]));

    if (cells.length < 6 || normalizeText(cells[3]) !== 'vs') continue;

    const leftTeam = cleanSchool(cells[1]);
    const leftScore = parseScore(cells[2]);
    const rightTeam = cleanSchool(cells[4]);
    const rightScore = parseScore(cells[5]);
    if (leftScore === null || rightScore === null) continue;

    const teamOnLeft = sameSchool(leftTeam, requested.team) && sameSchool(rightTeam, requested.opponent);
    const teamOnRight = sameSchool(rightTeam, requested.team) && sameSchool(leftTeam, requested.opponent);
    if (!teamOnLeft && !teamOnRight) continue;

    const officialTeamScore = teamOnLeft ? leftScore : rightScore;
    const officialOpponentScore = teamOnLeft ? rightScore : leftScore;
    foundTeams = {
      official: {
        team: teamOnLeft ? leftTeam : rightTeam,
        opponent: teamOnLeft ? rightTeam : leftTeam,
        teamScore: officialTeamScore,
        opponentScore: officialOpponentScore,
      },
    };

    if (officialTeamScore === requested.teamScore && officialOpponentScore === requested.opponentScore) {
      return { status: 'confirmed', ...foundTeams };
    }

    return { status: 'mismatch', ...foundTeams };
  }

  return foundTeams || { status: 'not_found' };
}

function cleanCell(value) {
  return decodeEntities(String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSchool(value) {
  return String(value)
    .replace(/\bDivision\s+(?:[1-6]A|8\s*Man)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameSchool(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSport(value) {
  return normalizeText(value)
    .replace(/^cowboys\s+/, '')
    .replace(/^cowgirls\s+/, '');
}

function parseScore(value) {
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function publicRequest(requested) {
  return {
    date: requested.date,
    sport: requested.sport,
    team: requested.team,
    opponent: requested.opponent,
    teamScore: requested.teamScore,
    opponentScore: requested.opponentScore,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

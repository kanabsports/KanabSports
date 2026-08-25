export async function onRequestGet() {
  const expiresAt = new Date('2026-08-25T15:41:32-06:00').getTime();
  const scores = Date.now() < expiresAt ? [
    {
      sport: 'Soccer',
      team: 'Cowgirls',
      opponent: 'Beaver',
      teamScore: 7,
      opponentScore: 3,
      status: 'FINAL',
      date: '2026-08-25'
    }
  ] : [];

  return new Response(JSON.stringify({ scores }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

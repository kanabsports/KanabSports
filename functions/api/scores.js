export async function onRequestGet() {
  // Approved scores will come from the Kanab Sports database in the next phase.
  // Keeping this API in place now lets the homepage ticker stay hidden until
  // there is real, approved score data to show.
  return new Response(JSON.stringify({ scores: [] }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  if (!env.SPORTS_DB) return json({ status: 'unavailable', documents: [] }, 503);
  await ensureSchema(env.SPORTS_DB);
  await env.SPORTS_DB.batch([
    env.SPORTS_DB.prepare(`DELETE FROM dev_documents WHERE slug=?`).bind('hurricane-football-2026-27'),
    env.SPORTS_DB.prepare(`DELETE FROM coach_documents WHERE id=?`).bind('hurricane-football-dev-test-2026-27')
  ]);
  const rows = await env.SPORTS_DB.prepare(`
    SELECT d.slug,d.payload_json,d.updated_at
    FROM dev_documents d
    JOIN coach_documents c ON c.id=d.document_id
    WHERE c.status='approved'
    ORDER BY d.updated_at DESC
  `).all();
  const documents = (rows.results || []).map(row => {
    try { return { slug: row.slug, updatedAt: row.updated_at, ...JSON.parse(row.payload_json) }; }
    catch { return null; }
  }).filter(Boolean);
  return json({ status: documents.length ? 'approved' : 'pending', documents });
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS dev_documents (
    document_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

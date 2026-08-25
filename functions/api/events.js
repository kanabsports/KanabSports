export async function onRequestGet(context){
  const{env}=context;
  if(!env.SPORTS_DB)return json({events:[]});
  try{
    await ensureSchema(env.SPORTS_DB);

    await env.SPORTS_DB.prepare(`
      DELETE FROM coach_submissions
      WHERE type='Event'
        AND (opponent='Halloween 5K' OR opponent='K-Town Cornhole Throwdown')
    `).run();

    const q=await env.SPORTS_DB.prepare(`
      SELECT
        id,team,sport,event_date,opponent,result,link,message,published_at,
        COALESCE(featured,0) AS featured,
        CASE
          WHEN COALESCE(featured,0)=1
           AND event_date IS NOT NULL
           AND event_date!=''
           AND date(event_date) BETWEEN date('now') AND date('now','+7 days')
          THEN 1 ELSE 0
        END AS feature_active
      FROM coach_submissions
      WHERE status='approved'
        AND type='Event'
        AND (event_date IS NULL OR event_date='' OR date(event_date)>=date('now'))
      ORDER BY
        feature_active DESC,
        CASE WHEN event_date IS NULL OR event_date='' THEN 1 ELSE 0 END ASC,
        date(event_date) ASC,
        datetime(published_at) ASC
      LIMIT 20
    `).all();

    return json({events:(q.results||[]).map(r=>({
      id:r.id,
      team:r.team||'',
      sport:(r.feature_active?'FEATURED · ':'')+(r.sport||''),
      date:r.event_date||'',
      name:r.opponent||r.team||r.sport||'Community sports event',
      details:r.message||r.result||'',
      meta:r.result||'',
      link:r.link||'',
      featured:Boolean(r.featured),
      feature_active:Boolean(r.feature_active)
    }))});
  }catch(e){
    console.error('Events API error',e);
    return json({events:[]});
  }
}

async function ensureSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_submissions (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,type TEXT NOT NULL,name TEXT,email TEXT,
    team TEXT,sport TEXT,event_date TEXT,opponent TEXT,result TEXT,link TEXT,message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,
    reviewed_at TEXT,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try{await db.prepare(`ALTER TABLE coach_submissions ADD COLUMN featured INTEGER NOT NULL DEFAULT 0`).run()}catch{}
}

function json(data){
  return new Response(JSON.stringify(data),{headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, no-cache, must-revalidate'
  }});
}

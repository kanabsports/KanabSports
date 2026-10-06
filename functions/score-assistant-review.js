import {sha256,clean} from './_lib/coach-auth.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return page('Score approval is temporarily unavailable.',false,503);
  const db=env.SPORTS_DB;
  try{
    await schema(db);
    if(request.method==='GET'){
      const u=new URL(request.url),token=clean(u.searchParams.get('token'),200),hint=clean(u.searchParams.get('action'),20);
      const row=await find(db,token);
      if(!row)return page('This score approval link is invalid or expired.',false,404);
      if(row.status!=='pending')return page(row.status==='approved'?'This score is already live.':'This score has already been denied.',row.status==='approved',409);
      if(!row.review_expires_at||Date.parse(row.review_expires_at)<Date.now())return page('This score approval link has expired.',false,410);
      return reviewPage(row,token,hint);
    }
    if(request.method==='POST'){
      const form=await request.formData(),token=clean(form.get('token'),200),action=clean(form.get('action'),20);
      if(!['approve','reject'].includes(action))return page('Choose approve or deny.',false,400);
      const row=await find(db,token);
      if(!row)return page('This score approval link is invalid or expired.',false,404);
      if(row.status!=='pending')return page(row.status==='approved'?'This score is already live.':'This score has already been denied.',row.status==='approved',409);
      if(!row.review_expires_at||Date.parse(row.review_expires_at)<Date.now())return page('This score approval link has expired.',false,410);
      const now=new Date().toISOString();
      if(action==='approve'){
        await db.prepare(`UPDATE coach_submissions SET status='approved',reviewed_at=?,published_at=?,coach_approved_at=?,review_token_hash=NULL WHERE id=? AND status='pending'`).bind(now,now,now,row.id).run();
        return page(`Published: ${row.team} ${row.result} vs ${row.opponent}`,true,200,'The approved final score is now live on Kanab Sports.');
      }
      await db.prepare(`UPDATE coach_submissions SET status='rejected',reviewed_at=?,review_token_hash=NULL WHERE id=? AND status='pending'`).bind(now,row.id).run();
      return page('Score denied. Nothing was published.',true,200,'The assistant can correct the score and submit again.');
    }
    return page('Method not allowed.',false,405);
  }catch(error){
    console.error('score assistant review error',error);
    return page('Could not review this score. Please try again.',false,500);
  }
}

async function find(db,token){
  if(!/^[a-f0-9]{48}$/i.test(String(token||'')))return null;
  const hash=await sha256(token);
  return await db.prepare(`SELECT id,team,sport,opponent,result,event_date,status,review_expires_at,coach_name,assistant_name,approval_mode
    FROM coach_submissions WHERE source='Score Assistant' AND review_token_hash=? LIMIT 1`).bind(hash).first();
}
async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_submissions (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,type TEXT NOT NULL,name TEXT,email TEXT,team TEXT,sport TEXT,event_date TEXT,opponent TEXT,result TEXT,link TEXT,message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  for(const q of [`ALTER TABLE coach_submissions ADD COLUMN coach_name TEXT`,`ALTER TABLE coach_submissions ADD COLUMN assistant_name TEXT`,`ALTER TABLE coach_submissions ADD COLUMN coach_approved_at TEXT`,`ALTER TABLE coach_submissions ADD COLUMN approval_mode TEXT`])try{await db.prepare(q).run()}catch{}
}
function reviewPage(row,token,hint){
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Approve Score · Kanab Sports</title><style>${css}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="eyebrow">Score assistant approval</div><h1>${esc(row.team)} ${esc(row.result)}</h1><p><strong>Opponent:</strong> ${esc(row.opponent)}<br><strong>Date:</strong> ${esc(row.event_date||'')}<br><strong>Submitted by:</strong> ${esc(row.assistant_name||'Score Assistant')}<br><strong>Responsible coach:</strong> ${esc(row.coach_name||'Coach')}</p><p class="note">Nothing is live yet. Approving publishes this score immediately with your name recorded as the responsible coach.</p><form method="post"><input type="hidden" name="token" value="${esc(token)}"><button class="approve" name="action" value="approve" type="submit">✓ Approve & Publish</button><button class="deny" name="action" value="reject" type="submit">Deny score</button></form></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
function page(message,success,status,detail='You can close this page when finished.'){
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Score Review · Kanab Sports</title><style>${css}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="badge">${success?'Done':'Needs attention'}</div><h1>${esc(message)}</h1><p>${esc(detail)}</p><a class="back" href="/">Back to Kanab Sports</a></main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
const css=`body{margin:0;background:#0b0c0f;color:#fff;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(580px,calc(100% - 32px));background:#15171b;border:1px solid #2d3036;border-radius:20px;padding:30px}.brand{font-size:24px;font-weight:900;margin-bottom:24px}.brand span,.eyebrow{color:#e32636}.eyebrow{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.3px}.badge{display:inline-block;padding:7px 10px;border-radius:999px;background:#123d20;color:#86e39c;font-size:11px;font-weight:900;text-transform:uppercase}h1{font-size:34px;line-height:1.05;margin:12px 0}p{color:#c4c7cd;line-height:1.55}.note{background:#22252b;border-radius:10px;padding:13px;font-size:13px}.approve,.deny,.back{display:block;width:100%;border:0;border-radius:10px;padding:15px;text-align:center;text-decoration:none;font-weight:900;cursor:pointer}.approve{background:#16833a;color:#fff;margin-top:20px;font-size:18px}.deny{background:transparent;color:#ff9ba4;border:1px solid #6b2a30;margin-top:15px}.back{background:#e32636;color:#fff;margin-top:18px;width:auto}`;
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
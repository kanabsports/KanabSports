export async function onRequest({request,env}){
  if(!env.SPORTS_DB||!env.RESEND_API_KEY)return page('Coach approval is not configured yet.',false,503);
  const url=new URL(request.url);
  try{
    await ensureSchema(env.SPORTS_DB);
    if(request.method==='GET'){
      const token=String(url.searchParams.get('token')||''),hint=String(url.searchParams.get('action')||'').toLowerCase();
      if(!token)return page('This approval link is invalid.',false,400);
      const row=await findRequest(env.SPORTS_DB,token);
      if(!row)return page('This approval link is invalid or has already been used.',false,404);
      if(row.status!=='pending')return page(`This coach request has already been ${row.status}.`,row.status==='approved',409);
      if(!row.review_expires_at||Date.parse(row.review_expires_at)<Date.now())return page('This coach access link has expired.',false,410);
      return reviewPage(row,token,hint);
    }

    if(request.method==='POST'){
      const form=await request.formData(),token=String(form.get('token')||''),action=String(form.get('action')||'').toLowerCase();
      if(!token||!['approve','reject'].includes(action))return page('Choose approve or deny.',false,400);
      const row=await findRequest(env.SPORTS_DB,token);
      if(!row)return page('This approval link is invalid or has already been used.',false,404);
      if(row.status!=='pending')return page(`This coach request has already been ${row.status}.`,row.status==='approved',409);
      if(!row.review_expires_at||Date.parse(row.review_expires_at)<Date.now())return page('This coach access link has expired.',false,410);

      if(action==='reject'){
        await env.SPORTS_DB.prepare(`UPDATE coach_access_requests SET status='rejected',reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(row.id).run();
        return page('Coach access denied.',true,200,'No account setup email was sent.');
      }

      const code=makeCode(),codeHash=await sha256(code),teamCode=row.team_code||await uniqueTeamCode(env.SPORTS_DB),accountUrl=`${url.origin}/coach-account.html`,portalUrl=`${url.origin}/coaches.html`,familyUrl=`${url.origin}/family/?code=${encodeURIComponent(teamCode)}`,subject='Your Kanab Sports coach account is approved';
      const team=row.team_name||row.organization||row.sport;
      const text=`Hi ${row.name},\n\nYour Kanab Sports coach account for ${team} has been approved.\n\n1. Set your password: ${accountUrl}\n2. Open your coach portal: ${portalUrl}\n\nParent team code: ${teamCode}\nParent invite: ${familyUrl}\n\nBackup access code: ${code}\n\nUse your own account rather than sharing this backup code.`;
      const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:620px"><div style="font-size:12px;font-weight:800;color:#a51420;text-transform:uppercase">Kanab Sports</div><h2>Your coach account is approved</h2><p>Hi ${esc(row.name)},</p><p><strong>${esc(row.role||'Coach')}</strong> · ${esc(team)}</p><p>Set your password once, then use your own coach account for scores, schedules, documents and team tools.</p><p><a href="${esc(accountUrl)}" style="display:block;background:#e32636;color:#fff;text-decoration:none;text-align:center;font-size:19px;font-weight:800;padding:17px 22px;border-radius:10px">Set coach password</a></p><p style="text-align:center"><a href="${esc(portalUrl)}">Open Coach Portal</a></p><div style="margin-top:20px;padding:14px;background:#f3f3f3;border-radius:9px"><strong>Parent team code</strong><br><span style="font-size:22px;letter-spacing:2px">${esc(teamCode)}</span><br><a href="${esc(familyUrl)}" style="font-size:13px">Parent invite link</a></div><div style="margin-top:12px;padding:14px;background:#f3f3f3;border-radius:9px"><strong>Backup access code</strong><br><span style="font-size:20px;letter-spacing:2px">${esc(code)}</span><br><span style="font-size:12px;color:#666">Use this only if you cannot sign in with your account.</span></div></div>`;
      const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`coach-access-approved-${row.id}`},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[row.email],reply_to:'howdy@kanabsports.com',subject,text,html})});
      if(!sent.ok)return page('The coach was verified, but the account setup email could not be sent.',false,502,'The request is still pending so you can retry.');
      await env.SPORTS_DB.prepare(`UPDATE coach_access_requests SET status='approved',access_code_hash=?,team_code=?,reviewed_at=datetime('now'),review_token_hash=NULL WHERE id=? AND status='pending'`).bind(codeHash,teamCode,row.id).run();
      return page(`Coach approved: ${row.name}`,true,200,`Account setup instructions were emailed to ${row.email}. If you don't see them within a minute, check Spam or Junk.`);
    }

    return page('Method not allowed.',false,405);
  }catch(error){
    console.error('coach access review error',error);
    return page('Something went wrong while reviewing coach access.',false,500);
  }
}

async function findRequest(db,token){
  const hash=await sha256(token);
  return await db.prepare(`SELECT id,name,email,organization,team_name,team_code,sport,role,status,review_expires_at FROM coach_access_requests WHERE review_token_hash=? LIMIT 1`).bind(hash).first();
}

function reviewPage(row,token,hint){
  const team=row.team_name||row.organization||row.sport;
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Review Coach Access · Kanab Sports</title><style>${css}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="eyebrow">Coach access review</div><h1>${esc(row.name)}</h1><div class="details"><b>${esc(row.role)}</b><br>${esc(team)}<br>${esc(row.sport)}<br>${esc(row.email)}</div><p>Confirm this person belongs with this team before activating their coach account.</p><form method="post"><input type="hidden" name="token" value="${esc(token)}"><button class="approve" name="action" value="approve" type="submit">✓ Approve Coach</button><button class="deny" name="action" value="reject" type="submit">Deny request</button></form></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

async function ensureSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_access_requests (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,organization TEXT NOT NULL,sport TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,team_url TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  for(const q of [`ALTER TABLE coach_access_requests ADD COLUMN access_code_hash TEXT`,`ALTER TABLE coach_access_requests ADD COLUMN team_name TEXT`,`ALTER TABLE coach_access_requests ADD COLUMN team_code TEXT`])try{await db.prepare(q).run()}catch{}
}
function makeCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const b=crypto.getRandomValues(new Uint8Array(8));return Array.from(b,x=>chars[x%chars.length]).join('')}\nasync function uniqueTeamCode(db){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let n=0;n<12;n++){const b=crypto.getRandomValues(new Uint8Array(6)),code='KS-'+Array.from(b,x=>chars[x%chars.length]).join('');const row=await db.prepare('SELECT id FROM coach_access_requests WHERE team_code=? LIMIT 1').bind(code).first();if(!row)return code}throw new Error('Could not create a unique team code')}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function page(message,success,status,detail='You can close this page when you’re finished.'){return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Kanab Sports Coach Access</title><style>${css}</style></head><body><main class="card"><div class="brand">KANAB <span>SPORTS</span></div><div class="badge">${success?'Done':'Needs attention'}</div><h1>${esc(message)}</h1><p>${esc(detail)}</p><a class="back" href="/">Back to Kanab Sports</a></main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
const css=`body{margin:0;background:#0b0c0f;color:#fff;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(580px,calc(100% - 32px));background:#15171b;border:1px solid #30343b;border-radius:20px;padding:30px}.brand{font-size:24px;font-weight:900;margin-bottom:24px}.brand span,.eyebrow{color:#e32636}.eyebrow{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.3px}.badge{display:inline-block;background:#153c24;color:#8be3a0;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:900;text-transform:uppercase}h1{font-size:34px;line-height:1.05;margin:12px 0}p,.details{color:#c3c7ce;line-height:1.55}.details{background:#22252b;border-radius:10px;padding:14px}.approve,.deny,.back{display:block;width:100%;border:0;border-radius:10px;padding:15px;text-align:center;text-decoration:none;font-weight:900;cursor:pointer}.approve{background:#16833a;color:#fff;margin-top:20px;font-size:18px}.deny{background:transparent;color:#ff9ba4;border:1px solid #6b2a30;margin-top:15px}.back{background:#e32636;color:#fff;margin-top:18px;width:auto}`;
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
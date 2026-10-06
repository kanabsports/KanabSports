import {ensureCoachCore,sha256,randomToken,clean,json,normalizePhone} from '../_lib/coach-auth.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Score reporting is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
    if(request.method==='GET'){
      const u=new URL(request.url),token=clean(u.searchParams.get('token'),200);
      const ctx=await assistantContext(db,token);
      if(!ctx)return json({success:false,error:'This score assistant link is invalid, expired, or revoked.'},404);
      return json({success:true,assistant:{name:ctx.assistant_name,trusted:Boolean(ctx.trusted)},coach:{name:ctx.coach_name,organization:(ctx.team_name||ctx.organization),sport:ctx.sport}});
    }
    if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
    const body=await request.json(),token=clean(body.token,200),ctx=await assistantContext(db,token);
    if(!ctx)return json({success:false,error:'This score assistant link is invalid, expired, or revoked.'},403);

    const date=clean(body.date,40),opponent=clean(body.opponent,180),result=clean(body.result,180),link=clean(body.link,700),details=clean(body.details,1200);
    if(!date||!opponent||!result)return json({success:false,error:'Date, opponent, and final score are required.'},400);
    if(!/\d/.test(result))return json({success:false,error:'Enter the final score using numbers.'},400);

    const id=crypto.randomUUID(),now=new Date().toISOString(),trusted=Boolean(ctx.trusted);
    let reviewToken='',reviewHash='',reviewExpires=null;
    if(!trusted){reviewToken=randomToken(24);reviewHash=await sha256(reviewToken);reviewExpires=new Date(Date.now()+2*86400000).toISOString();}

    const audit=`[[SCORE_ASSISTANT]]\nAssistant: ${ctx.assistant_name} <${ctx.assistant_email}>\nResponsible coach: ${ctx.coach_name}\nApproval mode: ${trusted?'trusted-auto':'coach-approval'}\n${details||''}`.trim();
    await db.prepare(`INSERT INTO coach_submissions
      (id,source,type,name,email,team,sport,event_date,opponent,result,link,message,status,review_token_hash,review_expires_at,reviewed_at,published_at,created_at)
      VALUES (?,'Score Assistant','Score',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,ctx.coach_name,ctx.coach_email,(ctx.team_name||ctx.organization),ctx.sport,date,opponent,result,link,audit,trusted?'approved':'pending',trusted?null:reviewHash,trusted?null:reviewExpires,trusted?now:null,trusted?now:null,now).run();
    await addAuditColumns(db);
    await db.prepare(`UPDATE coach_submissions SET accountable_coach_id=?,accountable_coach_name=?,submitted_by_type='score_assistant',assistant_id=?,assistant_name=?,approval_mode=?,coach_approved_at=? WHERE id=?`)
      .bind(ctx.coach_id,ctx.coach_name,ctx.assistant_id,ctx.assistant_name,trusted?'trusted_auto':'coach_sms',trusted?now:null,id).run();

    if(trusted)return json({success:true,status:'published',message:`Published. ${ctx.coach_name} is recorded as the responsible coach.`});

    const origin=new URL(request.url).origin,approve=`${origin}/score-assistant-review?token=${encodeURIComponent(reviewToken)}&action=approve`,deny=`${origin}/score-assistant-review?token=${encodeURIComponent(reviewToken)}&action=reject`;
    const coachPhone=normalizePhone(ctx.coach_phone);
    let channel='sms',notified=false;
    if(coachPhone&&smsConfigured(env)){
      const bodyText=`Kanab Sports score approval\n${ctx.assistant_name}: ${(ctx.team_name||ctx.organization)} ${result} vs ${opponent}.\nApprove: ${approve}\nDeny: ${deny}`;
      notified=await sendSms(env,coachPhone,bodyText);
    }
    if(!notified&&env.RESEND_API_KEY){
      channel='email';
      const text=`Score approval needed\n\n${ctx.assistant_name} submitted: ${(ctx.team_name||ctx.organization)} ${result} vs ${opponent} on ${date}.\n\nApprove & publish: ${approve}\nDeny: ${deny}`;
      const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:620px"><div style="font-size:12px;font-weight:800;color:#e32636;text-transform:uppercase">Kanab Sports · Score approval</div><h2>${esc((ctx.team_name||ctx.organization))} ${esc(result)} vs ${esc(opponent)}</h2><p>${esc(ctx.assistant_name)} submitted this score on your behalf.</p><a href="${esc(approve)}" style="display:block;background:#16833a;color:white;text-align:center;text-decoration:none;font-weight:800;padding:16px;border-radius:9px;margin:20px 0">Approve & publish</a><a href="${esc(deny)}" style="display:block;color:#9d2028;text-align:center;font-weight:700">Deny</a></div>`;
      const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`score-approval-${id}`},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[ctx.coach_email],subject:`Approve score — ${ctx.sport}`,text,html})});
      notified=sent.ok;
    }
    if(!notified){await db.prepare(`DELETE FROM coach_submissions WHERE id=?`).bind(id).run();return json({success:false,error:'We could not notify the coach for approval, so the score was not saved.'},502);}
    return json({success:true,status:'pending',channel,message:channel==='sms'?'Submitted. The coach was texted for approval.':'Submitted. The coach was emailed for approval because SMS was unavailable.'});
  }catch(e){console.error('score assistant submit error',e);return json({success:false,error:'Could not submit the score. Please try again.'},500);}
}

async function assistantContext(db,token){
  if(!/^[a-f0-9]{64}$/i.test(String(token||'')))return null;
  const hash=await sha256(token);
  return await db.prepare(`SELECT s.id AS assistant_id,s.name AS assistant_name,s.email AS assistant_email,s.trusted,
    a.id AS coach_id,a.name AS coach_name,a.email AS coach_email,a.phone AS coach_phone,a.organization,a.team_name,a.sport
    FROM coach_score_assistants s JOIN coach_access_requests a ON a.id=s.coach_id
    WHERE s.invite_token_hash=? AND s.status='active' AND datetime(s.invite_expires_at)>datetime('now') AND a.status='approved' LIMIT 1`).bind(hash).first();
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_score_assistants(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,status TEXT NOT NULL DEFAULT 'active',
    trusted INTEGER NOT NULL DEFAULT 0,trust_acknowledged_at TEXT,trust_acknowledged_text TEXT,invite_token_hash TEXT,invite_expires_at TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_submissions (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,type TEXT NOT NULL,name TEXT,email TEXT,team TEXT,sport TEXT,event_date TEXT,opponent TEXT,result TEXT,link TEXT,message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await addAuditColumns(db);
}
async function addAuditColumns(db){for(const q of [
  `ALTER TABLE coach_submissions ADD COLUMN accountable_coach_id TEXT`,`ALTER TABLE coach_submissions ADD COLUMN accountable_coach_name TEXT`,`ALTER TABLE coach_submissions ADD COLUMN submitted_by_type TEXT`,
  `ALTER TABLE coach_submissions ADD COLUMN assistant_id TEXT`,`ALTER TABLE coach_submissions ADD COLUMN assistant_name TEXT`,
  `ALTER TABLE coach_submissions ADD COLUMN approval_mode TEXT`,`ALTER TABLE coach_submissions ADD COLUMN coach_approved_at TEXT`
])try{await db.prepare(q).run()}catch{}}
function smsConfigured(env){return !!(env.TWILIO_AUTH_TOKEN&&/^AC[a-f0-9]{32}$/i.test(String(env.TWILIO_ACCOUNT_SID||''))&&/^MG[a-f0-9]{32}$/i.test(String(env.TWILIO_MESSAGING_SERVICE_SID||'')));}
async function sendSms(env,to,body){
  try{const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:to,MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID,Body:body})});return r.ok}catch{return false}
}
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
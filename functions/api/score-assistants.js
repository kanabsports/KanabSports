import {getCoach,canManageAssistants,sameOrigin,normalizePhone,ensureCoachCore,sha256,randomToken,clean,validEmail,json} from '../_lib/coach-auth.js';

const TRUST_TEXT='I trust this person’s score reporting and acknowledge my name is on the submitted score.';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Coach tools are temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your approved coach account.'},401);
    const canManage=canManageAssistants(coach);

    if(request.method==='GET'){
      const rows=(await db.prepare(`SELECT id,name,email,phone,status,trusted,trust_acknowledged_at,created_at,updated_at
        FROM coach_score_assistants WHERE coach_id=? ORDER BY status='active' DESC,created_at DESC`).bind(coach.id).all()).results||[];
      return json({success:true,coach:{id:coach.id,name:coach.name,email:coach.email,phone:coach.phone||'',sport:coach.sport,organization:coach.organization,role:coach.role},canManage,smsApprovalConfigured:smsConfigured(env),assistants:rows.map(r=>({...r,trusted:Boolean(r.trusted)})),trustText:TRUST_TEXT});
    }

    if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
    if(!sameOrigin(request))return json({success:false,error:'Open this page from kanabsports.com.'},403);
    if(!canManage)return json({success:false,error:'Only a head coach or coach can manage score assistants.'},403);

    const body=await request.json(),action=clean(body.action,40);

    if(action==='set_coach_phone'){
      const phone=normalizePhone(body.phone);
      if(!phone)return json({success:false,error:'Enter a valid U.S. mobile number.'},400);
      await db.prepare(`UPDATE coach_access_requests SET phone=? WHERE id=?`).bind(phone,coach.id).run();
      return json({success:true,message:'Coach mobile number saved.',phone});
    }

    if(action==='add'){
      if(!env.RESEND_API_KEY)return json({success:false,error:'Assistant invitations are not configured yet.'},503);
      const name=clean(body.name,120),email=clean(body.email,180).toLowerCase(),phone=normalizePhone(body.phone),trusted=Boolean(body.trusted),ack=Boolean(body.trust_acknowledged);
      if(!name||!validEmail(email))return json({success:false,error:'Enter the assistant’s name and a valid email.'},400);
      let coachPhone=normalizePhone(coach.phone);
      if(body.coach_phone){coachPhone=normalizePhone(body.coach_phone);if(!coachPhone)return json({success:false,error:'Enter a valid coach mobile number.'},400);await db.prepare(`UPDATE coach_access_requests SET phone=? WHERE id=?`).bind(coachPhone,coach.id).run();}
      if(trusted&&!ack)return json({success:false,error:'Check the trust acknowledgement before granting instant score publishing.'},400);
      if(!trusted&&!coachPhone)return json({success:false,error:'Add your mobile number so Pep can text you when this assistant submits a score.'},400);

      const existing=await db.prepare(`SELECT id FROM coach_score_assistants WHERE coach_id=? AND lower(email)=lower(?) AND status='active' LIMIT 1`).bind(coach.id,email).first();
      if(existing)return json({success:false,error:'That email is already an active score assistant.'},409);

      const id=crypto.randomUUID(),token=randomToken(32),tokenHash=await sha256(token),expires=new Date(Date.now()+180*86400000).toISOString(),now=new Date().toISOString();
      await db.prepare(`INSERT INTO coach_score_assistants
        (id,coach_id,name,email,phone,status,trusted,trust_acknowledged_at,trust_acknowledged_text,invite_token_hash,invite_expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?,?,?,?,?)`)
        .bind(id,coach.id,name,email,phone||'',trusted?1:0,trusted?now:null,trusted?TRUST_TEXT:null,tokenHash,expires,now,now).run();

      const origin=new URL(request.url).origin,invite=`${origin}/score-assistant/?token=${encodeURIComponent(token)}`;
      const mode=trusted
        ? `Coach ${coach.name} has authorized your scores to publish immediately under their responsibility.`
        : `Coach ${coach.name} will receive a text and approve each score before it goes live.`;
      const text=`Hi ${name},\n\n${coach.name} added you as a score assistant for ${coach.organization} · ${coach.sport}.\n\n${mode}\n\nSubmit scores here: ${invite}\n\nKeep this private link to yourself. The coach can revoke it at any time.`;
      const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:620px"><div style="font-size:12px;font-weight:800;color:#e32636;text-transform:uppercase">Kanab Sports · Score Assistant</div><h2>You can report scores for ${esc(coach.organization)}</h2><p>Hi ${esc(name)},</p><p>${esc(coach.name)} added you as a score assistant for <strong>${esc(coach.sport)}</strong>.</p><div style="padding:14px;background:#f5f5f5;border-radius:9px">${esc(mode)}</div><p><a href="${esc(invite)}" style="display:block;background:#e32636;color:#fff;text-align:center;text-decoration:none;font-weight:800;padding:16px;border-radius:9px">Open score assistant</a></p><p style="font-size:12px;color:#666">Keep this private link to yourself. The coach can revoke it at any time.</p></div>`;
      const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`score-assistant-${id}`},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[email],reply_to:coach.email,subject:`Score assistant access — ${coach.sport}`,text,html})});
      if(!sent.ok){await db.prepare(`DELETE FROM coach_score_assistants WHERE id=?`).bind(id).run();return json({success:false,error:'The invitation email could not be delivered. Nothing was saved.'},502);}
      return json({success:true,message:trusted?'Score assistant invited. Their scores can publish immediately under your responsibility.':'Score assistant invited. You will approve each score before it goes live.'});
    }

    if(action==='update_trust'){
      const id=clean(body.id,80),trusted=Boolean(body.trusted),ack=Boolean(body.trust_acknowledged);
      const row=await db.prepare(`SELECT id FROM coach_score_assistants WHERE id=? AND coach_id=? AND status='active'`).bind(id,coach.id).first();
      if(!row)return json({success:false,error:'Score assistant not found.'},404);
      if(trusted&&!ack)return json({success:false,error:'Check the trust acknowledgement before enabling instant publishing.'},400);
      if(!trusted&&!normalizePhone(coach.phone))return json({success:false,error:'Add your mobile number before requiring text approval.'},400);
      const now=new Date().toISOString();
      await db.prepare(`UPDATE coach_score_assistants SET trusted=?,trust_acknowledged_at=?,trust_acknowledged_text=?,updated_at=? WHERE id=? AND coach_id=?`)
        .bind(trusted?1:0,trusted?now:null,trusted?TRUST_TEXT:null,now,id,coach.id).run();
      return json({success:true,message:trusted?'Trusted reporting enabled.':'Coach approval required for future scores.'});
    }

    if(action==='revoke'){
      const id=clean(body.id,80),now=new Date().toISOString();
      await db.prepare(`UPDATE coach_score_assistants SET status='revoked',invite_token_hash=NULL,updated_at=? WHERE id=? AND coach_id=?`).bind(now,id,coach.id).run();
      return json({success:true,message:'Score assistant access revoked.'});
    }

    return json({success:false,error:'Unknown action.'},400);
  }catch(e){console.error('score assistants error',e);return json({success:false,error:'Could not finish this request. Please try again.'},500);}
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_score_assistants(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',trusted INTEGER NOT NULL DEFAULT 0,trust_acknowledged_at TEXT,
    trust_acknowledged_text TEXT,invite_token_hash TEXT,invite_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`).run();
  try{await db.prepare(`CREATE INDEX IF NOT EXISTS idx_score_assistant_coach ON coach_score_assistants(coach_id,status)`).run()}catch{}
}

function smsConfigured(env){return !!(env.TWILIO_AUTH_TOKEN&&/^AC[a-f0-9]{32}$/i.test(String(env.TWILIO_ACCOUNT_SID||''))&&/^MG[a-f0-9]{32}$/i.test(String(env.TWILIO_MESSAGING_SERVICE_SID||'')));}
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
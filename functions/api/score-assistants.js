import {invitationSchema,teamScope,sendEmail} from '../_lib/score-invitations.js';
import {getCoach,canManageAssistants,sameOrigin,normalizePhone,ensureCoachCore,sha256,randomToken,clean,validEmail,json} from '../_lib/coach-auth.js';

const TRUST_TEXT='I trust this person’s score reporting and acknowledge my name is on the submitted score.';

export async function onRequest(context){
  const response=await handle(context);
  response.headers.set('X-Pep-Score-Invitations-Version','2026-10-09-v1');
  return response;
}
async function handle({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Coach tools are temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await invitationSchema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your approved coach account.'},401);
    const canManage=canManageAssistants(coach)&&/^(head coach|coach)$/i.test(coach.role);

    if(request.method==='GET'){
      const rows=(await db.prepare(`SELECT id,name,email,phone,status,trusted,trust_acknowledged_at,created_at,updated_at,invite_expires_at,provider_message_id,delivery_status,last_error,sent_at,accepted_at
        FROM coach_score_assistants WHERE coach_id=? ORDER BY status='active' DESC,created_at DESC`).bind(coach.id).all()).results||[];
      return json({success:true,coach:{id:coach.id,name:coach.name,email:coach.email,phone:coach.phone||'',sport:coach.sport,organization:coach.organization,team_name:coach.team_name||'',role:coach.role},canManage,testEmailEnabled:env.SCORE_TEST_EMAIL_ENABLED!=='false',smsApprovalConfigured:smsConfigured(env),assistants:rows.map(r=>({...r,trusted:Boolean(r.trusted)})),trustText:TRUST_TEXT});
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

    if(action==='check_delivery'){
      const row=await db.prepare('SELECT id,provider_message_id FROM coach_score_assistants WHERE id=? AND coach_id=?').bind(clean(body.id,80),coach.id).first();
      if(!row?.provider_message_id)return json({success:false,error:'No provider receipt is available for this invitation. Resend it to obtain one.'},409);
      if(!env.RESEND_API_KEY)return json({success:false,error:'Email delivery is not configured.'},503);
      let response;try{response=await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_message_id)}`,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15000)})}catch{return json({success:false,error:'The provider could not be reached. Delivery remains unconfirmed.'},502)}
      const data=await response.json().catch(()=>({}));
      if(!response.ok)return json({success:false,error:'The provider could not return delivery status. The API key may require read access.'},502);
      const event=clean(data.last_event,80)||'unknown';
      const failed=['bounced','failed','suppressed','complained'].includes(event);
      await db.prepare(`UPDATE coach_score_assistants SET delivery_status=?,last_error=?,status=CASE WHEN ?=1 AND status='sent' THEN 'failed' ELSE status END,invite_token_hash=CASE WHEN ?=1 AND status='sent' THEN NULL ELSE invite_token_hash END WHERE id=? AND coach_id=?`).bind(event,failed?`The provider reports ${event}. Check the recipient address and Resend suppression or bounce logs.`:null,failed?1:0,failed?1:0,row.id,coach.id).run();
      return json({success:!failed,message:event==='delivered'?'The recipient mail server accepted the email. This does not confirm inbox placement.':`Provider delivery status: ${event}.`,error:failed?`The provider reports ${event}. Check the recipient address and provider logs before resending.`:undefined},failed?502:200);
    }
    if(action==='test_email'){
      if(env.SCORE_TEST_EMAIL_ENABLED==='false')return json({success:false,error:'Test email is disabled.'},404);
      const result=await sendEmail(env,{to:[coach.email],subject:'Pep score assistant delivery test',text:'This is a delivery test requested from your Score Assistants page. No assistant access was granted.'},`score-test-${crypto.randomUUID()}`);
      return json({success:result.accepted,message:result.accepted?'The provider accepted your test email. Check your inbox and spam folder; acceptance does not guarantee inbox delivery.':undefined,error:result.error},result.accepted?200:502);
    }
    if(action==='add'||action==='resend'){
      const previous=action==='resend'?await db.prepare('SELECT * FROM coach_score_assistants WHERE id=? AND coach_id=?').bind(clean(body.id,80),coach.id).first():null;
      if(action==='resend'&&(!previous||!['sent','failed','expired','active'].includes(previous.status)))return json({success:false,error:'This invitation cannot be resent.'},409);
      if(previous)Object.assign(body,{name:previous.name,email:previous.email,phone:previous.phone,trusted:!!previous.trusted,trust_acknowledged:!!previous.trust_acknowledged_at});
      
      const name=clean(body.name,120),email=clean(body.email,180).toLowerCase(),phone=normalizePhone(body.phone),trusted=Boolean(body.trusted),ack=Boolean(body.trust_acknowledged);
      if(!name||!validEmail(email))return json({success:false,error:'Enter the assistant’s name and a valid email.'},400);
      let coachPhone=normalizePhone(coach.phone);
      if(body.coach_phone){coachPhone=normalizePhone(body.coach_phone);if(!coachPhone)return json({success:false,error:'Enter a valid coach mobile number.'},400);await db.prepare(`UPDATE coach_access_requests SET phone=? WHERE id=?`).bind(coachPhone,coach.id).run();}
      if(trusted&&!ack)return json({success:false,error:'Check the trust acknowledgement before granting instant score publishing.'},400);
      

      const existing=await db.prepare(`SELECT id FROM coach_score_assistants WHERE team_scope=? AND lower(email)=lower(?) AND status IN ('pending','sent','accepted','active') AND id<>? LIMIT 1`).bind(teamScope(coach),email,previous?.id||'').first();
      if(existing)return json({success:false,error:'That email is already an active score assistant.'},409);

      const id=previous?.id||crypto.randomUUID(),token=randomToken(32),tokenHash=await sha256(token),expires=new Date(Date.now()+7*86400000).toISOString(),now=new Date().toISOString();
      const attempt=(previous?.send_attempt||0)+1;
      if(previous){
        const updated=await db.prepare(`UPDATE coach_score_assistants SET status='pending',invite_token_hash=?,invite_expires_at=?,provider_message_id=NULL,delivery_status='pending',last_error=NULL,send_attempt=?,updated_at=? WHERE id=? AND coach_id=? AND status IN ('sent','failed','expired','active') AND NOT EXISTS(SELECT 1 FROM coach_score_assistants x WHERE x.team_scope=? AND lower(x.email)=lower(?) AND x.id<>? AND x.status IN ('pending','sent','accepted','active'))`).bind(tokenHash,expires,attempt,now,id,coach.id,teamScope(coach),email,id).run();
        if(!(updated.meta?.changes??updated.changes))return json({success:false,error:'An invitation is already active or being sent.'},409);
      }else{
        const inserted=await db.prepare(`INSERT INTO coach_score_assistants
          (id,coach_id,name,email,phone,status,trusted,trust_acknowledged_at,trust_acknowledged_text,invite_token_hash,invite_expires_at,created_at,updated_at,team_scope,send_attempt,delivery_status)
          SELECT ?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,'pending'
          WHERE NOT EXISTS(SELECT 1 FROM coach_score_assistants WHERE team_scope=? AND lower(email)=lower(?) AND status IN ('pending','sent','accepted','active'))`)
          .bind(id,coach.id,name,email,phone||'',trusted?1:0,trusted?now:null,trusted?TRUST_TEXT:null,tokenHash,expires,now,now,teamScope(coach),attempt,teamScope(coach),email).run();
        if(!(inserted.meta?.changes??inserted.changes))return json({success:false,error:'An invitation is already active or being sent.'},409);
      }

      const origin=new URL(request.url).origin,invite=`${origin}/score-assistant/?token=${encodeURIComponent(token)}`;
      const mode=trusted
        ? `Coach ${coach.name} has authorized your scores to publish immediately under their responsibility.`
        : `Coach ${coach.name} will review and approve each score before it goes live.`;
      const text=`Hi ${name},\n\n${coach.name} added you as a score assistant for ${coach.team_name||coach.organization} · ${coach.sport}.\n\n${mode}\n\nSubmit scores here: ${invite}\n\nKeep this private link to yourself. The coach can revoke it at any time.`;
      const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:620px"><div style="font-size:12px;font-weight:800;color:#e32636;text-transform:uppercase">${esc(env.SCORE_EMAIL_BRAND||'Pep')} · Score Assistant</div><h2>You can report scores for ${esc(coach.team_name||coach.organization)}</h2><p>Hi ${esc(name)},</p><p>${esc(coach.name)} added you as a score assistant for <strong>${esc(coach.sport)}</strong>.</p><div style="padding:14px;background:#f5f5f5;border-radius:9px">${esc(mode)}</div><p><a href="${esc(invite)}" style="display:block;background:#e32636;color:#fff;text-align:center;text-decoration:none;font-weight:800;padding:16px;border-radius:9px">Open score assistant</a></p><p style="font-size:12px;color:#666">Keep this private link to yourself. The coach can revoke it at any time.</p></div>`;
      const sent=await sendEmail(env,{to:[email],reply_to:coach.email,subject:`Score assistant invitation — ${coach.sport}`,text,html},`score-assistant-${id}-${attempt}`);
      const updated=await db.prepare(`UPDATE coach_score_assistants SET status=?,provider_message_id=?,delivery_status=?,last_error=?,sent_at=?,updated_at=?,invite_token_hash=CASE WHEN ?=1 THEN invite_token_hash ELSE NULL END WHERE id=? AND status='pending' AND send_attempt=?`)
        .bind(sent.accepted?'sent':'failed',sent.id||null,sent.delivery,sent.error||null,sent.accepted?now:null,now,sent.accepted?1:0,id,attempt).run();
      if(!(updated.meta?.changes??updated.changes))return json({success:false,error:'This invitation was cancelled or expired while sending. Its link cannot grant access.'},409);
      if(!sent.accepted)return json({success:false,error:sent.error,status:'failed'},502);
      return json({success:true,status:'sent',message:'The email provider accepted the invitation. Inbox delivery is not yet confirmed. The assistant must accept before reporting scores.'});
    }

    if(action==='update_trust'){
      const id=clean(body.id,80),trusted=Boolean(body.trusted),ack=Boolean(body.trust_acknowledged);
      const row=await db.prepare(`SELECT id FROM coach_score_assistants WHERE id=? AND coach_id=? AND status IN ('accepted','active')`).bind(id,coach.id).first();
      if(!row)return json({success:false,error:'Score assistant not found.'},404);
      if(trusted&&!ack)return json({success:false,error:'Check the trust acknowledgement before enabling instant publishing.'},400);
      
      const now=new Date().toISOString();
      await db.prepare(`UPDATE coach_score_assistants SET trusted=?,trust_acknowledged_at=?,trust_acknowledged_text=?,updated_at=? WHERE id=? AND coach_id=?`)
        .bind(trusted?1:0,trusted?now:null,trusted?TRUST_TEXT:null,now,id,coach.id).run();
      return json({success:true,message:trusted?'Trusted reporting enabled.':'Coach approval required for future scores.'});
    }

    if(action==='revoke'||action==='cancel'){
      const id=clean(body.id,80),now=new Date().toISOString();
      const result=await db.prepare(`UPDATE coach_score_assistants SET status='revoked',invite_token_hash=NULL,updated_at=? WHERE id=? AND coach_id=?`).bind(now,id,coach.id).run();
      if(!(result.meta?.changes??result.changes))return json({success:false,error:'Invitation not found.'},404);
      return json({success:true,message:'Score assistant access revoked.'});
    }

    return json({success:false,error:'Unknown action.'},400);
  }catch(e){console.error('score assistants error',e);return json({success:false,error:'Could not finish this request. Please try again.'},500);}
}

function smsConfigured(env){return !!(env.TWILIO_AUTH_TOKEN&&/^AC[a-f0-9]{32}$/i.test(String(env.TWILIO_ACCOUNT_SID||''))&&/^MG[a-f0-9]{32}$/i.test(String(env.TWILIO_MESSAGING_SERVICE_SID||'')));}
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
import {getCoach,canManageAssistants,ensureCoachCore,sha256,randomToken,clean,validEmail,json} from '../_lib/coach-auth.js';
import {assistantCoachSchema,activeSponsor,syncAssistantAccess} from '../_lib/assistant-coaches.js';
import {ensureTeamCode} from './coach-messages.js';
import {sendEmail} from '../_lib/score-invitations.js';
import {passwordHash,makeSession} from './coach-account.js';

const invitationFrom=`FROM coach_assistant_invites i
  JOIN coach_access_requests s ON s.id=i.sponsor_id`;

export async function onRequest({request,env}) {
  const db=env.SPORTS_DB;
  if(!db)return json({error:'Coach tools are temporarily unavailable.'},503);
  try {
    await ensureCoachCore(db);
    await assistantCoachSchema(db);
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
    let body={};
    if(request.method==='POST') {
      if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open your invitation or Coach Portal to continue.'},403);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},415);
      const raw=await request.text();
      if(raw.length>4000)return json({error:'Request too large.'},413);
      try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
      if(['preview','accept'].includes(body.action))return await acceptInvitation(db,body);
    }
    const coach=await getCoach(request,db);
    if(!coach)return json({error:'Sign in with your coach account first.'},401);
    const canInvite=canManageAssistants(coach)&&/^(head coach|coach)$/i.test(coach.role);
    if(!canInvite)return json({error:'Only approved Coaches and Head Coaches can invite assistant coaches.'},403);
    coach.team_code=await ensureTeamCode(db,coach);
    if(request.method==='GET') {
      const invites=(await db.prepare(`SELECT id,name,email,status,expires_at,last_error,created_at
        FROM coach_assistant_invites WHERE sponsor_id=? AND team_code=? ORDER BY created_at DESC`).bind(coach.id,coach.team_code).all()).results;
      return json({success:true,team:coach.team_name||coach.organization,sport:coach.sport,invites});
    }
    if(body.action==='revoke') {
      const row=await db.prepare(`UPDATE coach_assistant_invites SET status='revoked',token_hash=NULL,updated_at=datetime('now')
        WHERE id=? AND sponsor_id=? AND team_code=? RETURNING accepted_coach_id`).bind(clean(body.id,80),coach.id,coach.team_code).first();
      if(!row)return json({error:'Invitation not found.'},404);
      if(row.accepted_coach_id)await db.prepare('DELETE FROM coach_sessions WHERE coach_id=?').bind(row.accepted_coach_id).run();
      await syncAssistantAccess(db);
      return json({success:true,message:'Assistant access removed.'});
    }
    if(!['invite','resend'].includes(body.action))return json({error:'Unknown action.'},400);
    let previous=null;
    if(body.action==='resend') {
      previous=await db.prepare(`SELECT * FROM coach_assistant_invites WHERE id=? AND sponsor_id=? AND team_code=?
        AND status IN ('sent','failed','expired')`).bind(clean(body.id,80),coach.id,coach.team_code).first();
      if(!previous)return json({error:'This invitation cannot be resent. Refresh the page.'},409);
    }
    const name=previous?.name||clean(body.name,120),email=(previous?.email||clean(body.email,180)).toLowerCase();
    if(!name||!validEmail(email))return json({error:'Enter the assistant’s name and email.'},400);
    if(email===coach.email.toLowerCase())return json({error:'Enter your assistant’s email address.'},400);
    const existing=await db.prepare(`SELECT status FROM coach_access_requests WHERE lower(email)=?
      AND (team_code=? OR (organization=? AND COALESCE(team_name,'')=? AND sport=?))
      AND status IN ('approved','rejected') LIMIT 1`).bind(email,coach.team_code,coach.organization,coach.team_name||'',coach.sport).first();
    if(existing)return json({error:existing.status==='approved'?'This person already has coach access to your team.':'Ask Kanab Sports to review this person’s previous coach decision.'},409);
    const recent=await db.prepare(`SELECT count(*) AS n FROM coach_assistant_invites
      WHERE sponsor_id=? AND datetime(updated_at)>datetime('now','-1 hour')`).bind(coach.id).first();
    if(recent.n>=20)return json({error:'Please wait an hour before sending more invitations.'},429);
    if(previous&&Date.now()-Date.parse(previous.updated_at.replace(' ','T')+'Z')<30000)return json({error:'Please wait 30 seconds before resending.'},429);
    const id=previous?.id||crypto.randomUUID(),token=randomToken(),hash=await sha256(token);
    const duplicate=await db.prepare(`SELECT id FROM coach_assistant_invites WHERE team_code=? AND email=?
      AND status IN ('sending','sent','accepted') AND id<>?`).bind(coach.team_code,email,id).first();
    if(duplicate)return json({error:'An invitation or assistant membership already exists for this email.'},409);
    try {
      if(previous) {
        const claim=await db.prepare(`UPDATE coach_assistant_invites SET status='sending',token_hash=?,
          expires_at=datetime('now','+7 days'),updated_at=datetime('now'),last_error=NULL
          WHERE id=? AND sponsor_id=? AND status IN ('sent','failed','expired') RETURNING id`).bind(hash,id,coach.id).first();
        if(!claim)return json({error:'Another request changed this invitation. Refresh and try again.'},409);
      }else {
        await db.prepare(`INSERT INTO coach_assistant_invites(id,sponsor_id,team_code,name,email,status,token_hash,expires_at,updated_at)
          VALUES(?,?,?,?,?,'sending',?,datetime('now','+7 days'),datetime('now'))`).bind(id,coach.id,coach.team_code,name,email,hash).run();
      }
    }catch(error){if(String(error.message).includes('UNIQUE'))return json({error:'An invitation already exists for this email.'},409);throw error;}
    const link=new URL('/assistant-coaches.html',request.url);link.hash='invite='+token;
    const text=`Hi ${name},\n\n${coach.name} invited you to coach ${coach.team_name||coach.organization} (${coach.sport}) on Kanab Sports.\n\nJoin as an assistant coach and set your password here:\n${link}\n\nYou’ll have the team’s schedule, coach announcements and score tools. Your invitation is already approved by the lead coach.\n\nThis personal link expires in 7 days. Your access is managed by ${coach.name}.\n\nKanab Sports · Powered by Pep`;
    const sent=await sendEmail(env,{to:[email],reply_to:coach.email,subject:`Coach ${coach.team_name||coach.organization} with us`,text},`assistant-coach-${id}-${hash.slice(0,12)}`);
    const saved=await db.prepare(`UPDATE coach_assistant_invites SET status=?,provider_message_id=?,last_error=?,
      token_hash=CASE WHEN ? THEN token_hash ELSE NULL END,updated_at=datetime('now')
      WHERE id=? AND status='sending' AND token_hash=? RETURNING id`)
      .bind(sent.accepted?'sent':'failed',sent.id||null,sent.error||null,sent.accepted?1:0,id,hash).first();
    if(!saved)return json({error:'This invitation was cancelled while sending.'},409);
    if(!sent.accepted)return json({error:sent.error},502);
    return json({success:true,message:'Invitation sent. They can open the email and set their password to join your team.'});
  }catch(error) {
    console.error('Assistant coach invitation failed',error);
    return json({error:'Could not finish this request. Please try again.'},500);
  }
}

async function acceptInvitation(db,body) {
  if(!/^[a-f0-9]{64}$/.test(String(body.token||'')))return json({error:'This invitation link is invalid.'},404);
  const hash=await sha256(body.token);
  const invite=await db.prepare(`SELECT i.*,s.name AS sponsor_name,s.organization,s.sport,s.team_name ${invitationFrom}
    WHERE i.token_hash=? AND i.status='sent' AND datetime(i.expires_at)>datetime('now') AND ${activeSponsor()}`).bind(hash).first();
  if(!invite)return json({error:'This invitation is unavailable or has already been used. Sign in if you already joined, or ask the lead coach for a new invitation.'},410);
  if(body.action==='preview')return json({success:true,name:invite.name,email:invite.email,team:invite.team_name||invite.organization,sport:invite.sport,coach:invite.sponsor_name});
  const password=String(body.password||'');
  if(password.length<10||password.length>200)return json({error:'Use a password with at least 10 characters.'},400);
  const coachId=crypto.randomUUID(),salt=randomToken(16),iterations=60000,pwd=await passwordHash(password,salt,iterations);
  const results=await db.batch([
    db.prepare(`INSERT INTO coach_access_requests(id,name,email,organization,sport,role,team_name,team_code,status,
      reviewed_at,password_hash,password_salt,password_iterations)
      SELECT ?,i.name,i.email,s.organization,s.sport,'Assistant Coach',s.team_name,i.team_code,'approved',datetime('now'),?,?,?
      ${invitationFrom} WHERE i.id=? AND i.token_hash=? AND i.status='sent'
      AND datetime(i.expires_at)>datetime('now') AND ${activeSponsor()}`).bind(coachId,pwd,salt,iterations,invite.id,hash),
    db.prepare(`UPDATE coach_assistant_invites SET status='accepted',token_hash=NULL,accepted_coach_id=?,updated_at=datetime('now')
      WHERE id=? AND token_hash=? AND status='sent' AND EXISTS(SELECT 1 FROM coach_access_requests WHERE id=?)`).bind(coachId,invite.id,hash,coachId),
    db.prepare(`UPDATE coach_access_requests SET status='superseded',review_token_hash=NULL
      WHERE status='pending' AND lower(email)=? AND organization=? AND COALESCE(team_name,'')=? AND sport=?
      AND EXISTS(SELECT 1 FROM coach_assistant_invites WHERE id=? AND accepted_coach_id=?)`)
      .bind(invite.email,invite.organization,invite.team_name||'',invite.sport,invite.id,coachId)
  ]);
  if(!(results[0].meta?.changes??results[0].changes))return json({error:'This invitation has changed. Ask the lead coach to check it.'},409);
  await syncAssistantAccess(db);
  return makeSession(db,coachId,invite.email,{success:true,message:'You’re on the team!',coachId,email:invite.email});
}

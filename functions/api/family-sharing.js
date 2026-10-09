import {parentSession} from '../_lib/parent-access.js';
import {sha256,randomToken,validEmail,json} from '../_lib/coach-auth.js';
import {sharingSchema,shareable,audit} from '../_lib/family-sharing.js';
import {scheduleEvents} from '../_lib/team-schedule.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
import {sendEmail} from '../_lib/score-invitations.js';
import {messagingOrigin,throttle} from '../_lib/private-messages.js';
export async function onRequest({request,env}){
 if(env.FAMILY_SHARING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Family sharing pilot is not enabled.'},503);
 const db=env.SPORTS_DB,url=new URL(request.url);
 try{
 const parent=await parentSession(request,db);if(!parent)return json({error:'Sign in or create your free My Family account first.'},401);
 await sharingSchema(db);
 if(request.method==='GET'){
 const grants=(await db.prepare("SELECT id,recipient_email,team_codes,can_edit,is_driver,status FROM family_delegates WHERE owner_email=? ORDER BY created DESC").bind(parent.email).all()).results||[];
 const invites=(await db.prepare("SELECT id,recipient_email,can_edit,is_driver,expires,status,delivery FROM family_share_invites WHERE owner_email=? ORDER BY created DESC LIMIT 50").bind(parent.email).all()).results||[];
 const shared=(await db.prepare("SELECT * FROM family_delegates WHERE recipient_email=? AND status='active'").bind(parent.email).all()).results||[];
 const schedules=[];
 for(const grant of shared)for(const code of JSON.parse(grant.team_codes))if(await shareable(db,grant.owner_email,code)){
 const owner=await db.prepare('SELECT name FROM parent_accounts WHERE email=?').bind(grant.owner_email).first();
 const coach=CONNECTIONS[code]?null:await db.prepare("SELECT team_name,organization FROM coach_access_requests WHERE team_code=? AND status='approved' LIMIT 1").bind(code).first();
 schedules.push({owner:grant.owner_email,owner_name:owner?.name||'Family',code,name:CONNECTIONS[code]?.name||coach?.team_name||coach?.organization||code,can_edit:!!grant.can_edit,is_driver:!!grant.is_driver,events:CONNECTIONS[code]?.events||await scheduleEvents(db,code)});
 }
 const entries=(await db.prepare('SELECT DISTINCT team_code FROM parent_family WHERE email=?').bind(parent.email).all()).results||[];
 const teams=[];for(const e of entries)if(await shareable(db,parent.email,e.team_code))teams.push(e.team_code);
 return json({sender_email:parent.email,grants,invites,schedules,teams});
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==url.origin)return json({error:'Open My Family to manage sharing.'},403);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too large.'},413);const b=JSON.parse(raw);if(!b||typeof b!=='object')return json({error:'Invalid request.'},400);
 // Separate limiter, no dependency on activating private messaging.
 await db.prepare('CREATE TABLE IF NOT EXISTS private_message_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)').run();
 if(!await throttle(db,{role:'family-sharing',id:parent.email}))return json({error:'Please wait before trying again.'},429);
 if(b.action==='rotate_code'){
 const code=randomToken(16).toUpperCase();await db.prepare('INSERT INTO family_share_codes VALUES(?,?,?) ON CONFLICT(owner_email) DO UPDATE SET code_hash=excluded.code_hash,updated=excluded.updated').bind(parent.email,await sha256(code),Date.now()).run();
 await audit(db,parent.email,parent.email,'rotate_code',parent.email).run();return json({code,message:'Share this personal code with someone you trust. It lets them request access; you still choose their permissions.'});
 }
 if(b.action==='request_code'){
 const owner=await db.prepare('SELECT owner_email FROM family_share_codes WHERE code_hash=?').bind(await sha256(String(b.code||'').trim().toUpperCase())).first();
 if(!owner||owner.owner_email===parent.email)return json({error:'Code unavailable.'},400);
 const id=crypto.randomUUID();await db.prepare("INSERT INTO family_share_invites VALUES(?,?,?,?,?,0,0,?,'requested',?,NULL)").bind(id,owner.owner_email,parent.email,await sha256(randomToken()),'[]',Date.now()+7*86400000,Date.now()).run();
 return json({requested:true,message:'The head parent must approve the request and choose which schedules to share.'});
 }
 if(b.action==='invite'){
 const recipient=String(b.recipient_email||'').trim().toLowerCase(),codes=[...new Set(Array.isArray(b.team_codes)?b.team_codes:[])];
 if(!validEmail(recipient)||recipient.length>254||recipient===parent.email||!codes.length||codes.length>20||typeof b.can_edit!=='boolean'||typeof b.is_driver!=='boolean')return json({error:'Choose a recipient, schedules and permissions.'},400);
 for(const code of codes)if(typeof code!=='string'||!await shareable(db,parent.email,code))return json({error:'Only your verified recreation/travel or public schedules can be shared.'},403);
 const id=crypto.randomUUID(),token=randomToken(),now=Date.now();
 await db.prepare("INSERT INTO family_share_invites VALUES(?,?,?,?,?,?,?,?, 'pending',?,NULL)").bind(id,parent.email,recipient,await sha256(token),JSON.stringify(codes),+b.can_edit,+b.is_driver,now+7*86400000,now).run();
 const link=messagingOrigin(env)+'/family/access/#invite='+token;
 const result=await sendEmail(env,{to:[recipient],reply_to:parent.email,subject:'You have a family schedule invitation in Pep',text:`${parent.email} invited you to their family schedule in Pep.\n\n1. Open ${link}\n2. Sign in or create a free account with this email address: ${recipient}.\n3. Accept the invitation. The selected schedules automatically appear under Shared with you in My Family; no team codes to enter.\n\nAccess: ${b.can_edit?'May edit shared driver plans':'View only'}. Driver: ${b.is_driver?'Yes':'No'}. This does not include private coach conversations or private school records. Invitation expires in 7 days.`},'family-invite-'+id);
 await db.prepare('UPDATE family_share_invites SET delivery=? WHERE id=?').bind(result.accepted?'accepted':result.delivery,id).run();await audit(db,parent.email,parent.email,'invite',id).run();return json({id,accepted:result.accepted,delivery:result.accepted?'accepted':result.delivery,error:result.error},result.accepted?200:502);
 }
 if(b.action==='accept'){
 const hash=await sha256(String(b.token||'')),now=Date.now();
 const invite=await db.prepare("SELECT * FROM family_share_invites WHERE token_hash=? AND recipient_email=? AND status='pending' AND expires>?").bind(hash,parent.email,now).first();
 if(!invite)return json({error:'Invitation unavailable, expired, used, or addressed to another email.'},403);
 for(const code of JSON.parse(invite.team_codes))if(!await shareable(db,invite.owner_email,code))return json({error:'The sharing parent no longer has access. Ask for a new invitation.'},403);
 // Upsert and consume in one batch. A pending invite never grants access.
 await db.batch([db.prepare(`INSERT INTO family_delegates SELECT id,owner_email,recipient_email,team_codes,can_edit,is_driver,'active',? FROM family_share_invites WHERE id=? AND status='pending' AND expires>? ON CONFLICT(owner_email,recipient_email) DO UPDATE SET team_codes=excluded.team_codes,can_edit=excluded.can_edit,is_driver=excluded.is_driver,status='active'`).bind(now,invite.id,now),db.prepare("UPDATE family_share_invites SET status='accepted' WHERE id=? AND status='pending'").bind(invite.id),audit(db,invite.owner_email,parent.email,'accept',invite.id)]);
 return json({accepted:true,message:'Schedules added to Shared with you in My Family.'});
 }
 if(b.action==='permissions'||b.action==='revoke'){
 const grant=await db.prepare('SELECT id,recipient_email FROM family_delegates WHERE id=? AND owner_email=?').bind(String(b.id||''),parent.email).first();if(!grant)return json({error:'Only the head parent can change these permissions.'},403);
 if(b.action==='permissions'&&(typeof b.can_edit!=='boolean'||typeof b.is_driver!=='boolean'))return json({error:'Choose explicit permissions.'},400);
 await db.batch([db.prepare('UPDATE family_delegates SET can_edit=?,is_driver=?,status=? WHERE id=? AND owner_email=?').bind(b.action==='revoke'?0:+b.can_edit,b.action==='revoke'?0:+b.is_driver,b.action==='revoke'?'revoked':'active',grant.id,parent.email),db.prepare("UPDATE family_share_invites SET status='cancelled' WHERE owner_email=? AND recipient_email=? AND status='pending'").bind(parent.email,grant.recipient_email),audit(db,parent.email,parent.email,b.action,grant.id)]);return json({saved:true});
 }
 if(b.action==='cancel_invite'){await db.prepare("UPDATE family_share_invites SET status='cancelled' WHERE id=? AND owner_email=? AND status IN ('pending','requested')").bind(String(b.id||''),parent.email).run();return json({saved:true});}
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Family sharing could not complete. Refresh to check status.'},503);}
}

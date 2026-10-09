import {sharingSchema,delegated} from './family-sharing.js';
import {allowedChannels} from './notification-preferences.js';
import {sendEmail} from './score-invitations.js';
import {pushSchema,sendPush} from './web-push.js';
import {messagingOrigin} from './private-messages.js';
import {teamPolicy} from './school-access.js';
import {hasMembership} from './parent-access.js';
export async function notifySchedule(db,env,code,event,revision){
 await pushSchema(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS schedule_notice_attempts(event_key TEXT NOT NULL,recipient TEXT NOT NULL,email_status TEXT NOT NULL,push_status TEXT NOT NULL,PRIMARY KEY(event_key,recipient))').run();
 const recipients=(await db.prepare("SELECT DISTINCT email FROM guardian_memberships WHERE team_code=? AND status='approved' AND expires>?").bind(code,Date.now()).all()).results||[];
 if(env.FAMILY_SHARING_ENABLED==='true'){
  await sharingSchema(db);const shares=(await db.prepare("SELECT DISTINCT recipient_email FROM family_delegates WHERE status='active' AND EXISTS(SELECT 1 FROM json_each(team_codes) WHERE value=?)").bind(code).all()).results||[];
  for(const s of shares)if(!recipients.some(r=>r.email===s.recipient_email))recipients.push({email:s.recipient_email});
 }
 async function authorized(email){if(await hasMembership(db,email,code))return true;if(env.FAMILY_SHARING_ENABLED!=='true')return false;const grants=(await db.prepare("SELECT owner_email FROM family_delegates WHERE recipient_email=? AND status='active'").bind(email).all()).results||[];for(const g of grants)if(await delegated(db,email,g.owner_email,code))return true;return false;}
 const key=code+':'+event+':'+revision;
 for(const {email} of recipients){
 const policy=await teamPolicy(db,code);if(!policy||!['rec','travel'].includes(policy.kind)||policy.school_id||!await authorized(email))continue;
 const claim=await db.prepare("INSERT OR IGNORE INTO schedule_notice_attempts VALUES(?,?,'processing','processing') RETURNING recipient").bind(key,email).first();if(!claim)continue;
 try{const channels=await allowedChannels(db,'parent',email,'schedule');
 const mail=channels.email?await sendEmail(env,{to:[email],subject:'A team schedule changed in Pep',text:'Open My Family for the current schedule:\n'+messagingOrigin(env)+'/family/\n\nPreviously sent driver reminders may contain the old details. Please review your driver plan.'},'schedule-'+await hash(key+email)):{delivery:'muted'};
 const devices=channels.push?(await db.prepare('SELECT id,endpoint FROM push_devices WHERE parent_email=?').bind(email).all()).results||[]:[];
 if(channels.push){const privateDevices=(await db.prepare("SELECT id,endpoint FROM private_push_devices WHERE role='parent' AND identity=?").bind(email).all()).results||[];for(const d of privateDevices)if(!devices.some(x=>x.endpoint===d.endpoint))devices.push({...d,private:true});}
 const statuses=[];for(const device of devices){if(!await authorized(email)){statuses.push('suppressed');continue;}try{statuses.push(await sendPush(db,device,device.private?'private_push_devices':'push_devices'));}catch{statuses.push('unconfirmed');}}
 await db.prepare('UPDATE schedule_notice_attempts SET email_status=?,push_status=? WHERE event_key=? AND recipient=?').bind(mail.accepted?'accepted':mail.delivery,channels.push?(statuses.length?(statuses.every(x=>x==='accepted')?'accepted':'failed'):'no_devices'):'muted',key,email).run();
 }catch{await db.prepare("UPDATE schedule_notice_attempts SET email_status='unconfirmed',push_status='unconfirmed' WHERE event_key=? AND recipient=?").bind(key,email).run();}
 }
}
async function hash(v){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');}

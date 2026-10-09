import {getCoach,sha256} from './coach-auth.js';
import {parentSession} from './parent-access.js';
import {sendEmail} from './score-invitations.js';
import {sendPush} from './web-push.js';

// Explicit pilot enrollment, not coach-entered organization labels or public codes.
export async function schema(db){
 for(const sql of [
 `CREATE TABLE IF NOT EXISTS private_message_teams(team_code TEXT PRIMARY KEY,organization_id TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),UNIQUE(team_code,organization_id))`,
 `CREATE TABLE IF NOT EXISTS private_message_coaches(team_code TEXT NOT NULL,coach_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),PRIMARY KEY(team_code,coach_id))`,
 `CREATE TABLE IF NOT EXISTS private_conversations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,team_code TEXT NOT NULL,parent_email TEXT NOT NULL,coach_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(organization_id,team_code,parent_email,coach_id))`,
 `CREATE INDEX IF NOT EXISTS private_conversations_parent ON private_conversations(parent_email,created)`,
 `CREATE INDEX IF NOT EXISTS private_conversations_coach ON private_conversations(coach_id,created)`,
 `CREATE TABLE IF NOT EXISTS private_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT NOT NULL,sender_role TEXT NOT NULL CHECK(sender_role IN ('parent','coach')),sender_id TEXT NOT NULL,sender_name TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS private_messages_history ON private_messages(conversation_id,sequence)`,
 `CREATE TABLE IF NOT EXISTS private_message_notices(message_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',email_status TEXT NOT NULL DEFAULT 'pending',push_status TEXT NOT NULL DEFAULT 'pending',updated INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS private_push_devices(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,role TEXT NOT NULL,identity TEXT NOT NULL,token_hash TEXT NOT NULL,updated INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS private_message_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)`
 ])await db.prepare(sql).run();
}
export async function identity(request,db,role){
 if(role==='coach'){const c=await getCoach(request,db);return c?{role,id:c.id,name:c.name,email:c.email}:null;}
 if(role!=='parent')return null;
 const p=await parentSession(request,db);if(!p)return null;
 const a=await db.prepare('SELECT name FROM parent_accounts WHERE email=?').bind(p.email).first();
 return a?{role,id:p.email,email:p.email,name:a.name}:null;
}
// Every read, write and delivery checks BOTH participants, current team policy and
// organization mapping. School teams cannot be enabled via this allowlist.
export const eligibleSQL=`SELECT t.team_code,t.organization_id,t.name AS team_name,a.id AS coach_id,a.name AS coach_name,a.email AS coach_email
 FROM private_message_teams t JOIN school_teams s ON s.team_code=t.team_code
 JOIN private_message_coaches pc ON pc.team_code=t.team_code
 JOIN coach_access_requests a ON a.id=pc.coach_id
 WHERE t.enabled=1 AND s.kind IN ('rec','travel') AND s.school_id IS NULL
 AND pc.active=1 AND a.status='approved'`;
export async function eligible(db,team,coach,parent,org){
 return db.prepare(eligibleSQL+` AND t.team_code=? AND a.id=? AND t.organization_id=?
 AND EXISTS(SELECT 1 FROM guardian_memberships g WHERE g.team_code=t.team_code AND g.email=? AND g.status='approved' AND g.expires>?)`).bind(team,coach,org,parent,Date.now()).first();
}
export async function conversation(db,id,actor){
 const c=await db.prepare('SELECT * FROM private_conversations WHERE id=?').bind(id).first();
 if(!c||!(actor.role==='parent'?c.parent_email===actor.id:c.coach_id===actor.id))return null;
 const access=await eligible(db,c.team_code,c.coach_id,c.parent_email,c.organization_id);
 return access?{...c,...access}:null;
}
export async function throttle(db,actor){
 const now=Date.now(),key=await sha256(actor.role+':'+actor.id)+':'+Math.floor(now/60000);
 await db.prepare('DELETE FROM private_message_limits WHERE expires<?').bind(now).run();
 const row=await db.prepare('INSERT INTO private_message_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+120000).first();
 return row.count<=30;
}
export function messagingOrigin(env){
 const origin=new URL(env.PRIVATE_MESSAGING_BASE_URL||'https://kanabsports.com');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash||!(origin.hostname==='kanabsports.com'||origin.hostname.endsWith('.pages.dev')))throw Error('Invalid messaging base URL');
 return origin.origin;
}
export async function deliver(db,env,messageId){
 // Claim once. A crash remains visibly unconfirmed; never claim device delivery.
 const claim=await db.prepare("UPDATE private_message_notices SET status='processing',updated=? WHERE message_id=? AND status='pending' RETURNING message_id").bind(Date.now(),messageId).first();
 if(!claim)return;
 try{
 const m=await db.prepare(`SELECT m.sender_role,c.* FROM private_messages m JOIN private_conversations c ON c.id=m.conversation_id WHERE m.id=?`).bind(messageId).first();
 const access=m&&await eligible(db,m.team_code,m.coach_id,m.parent_email,m.organization_id);
 if(!access){await db.prepare("UPDATE private_message_notices SET status='suppressed',email_status='suppressed',push_status='suppressed',updated=? WHERE message_id=?").bind(Date.now(),messageId).run();return;}
 const role=m.sender_role==='parent'?'coach':'parent',recipient=role==='coach'?m.coach_id:m.parent_email;
 const link=`${messagingOrigin(env)}/messages/?role=${role}&conversation=${encodeURIComponent(m.id)}`;
 const email=await sendEmail(env,{to:[role==='coach'?access.coach_email:m.parent_email],subject:'New private message in Pep',text:`You have a new private message in Pep. Sign in to read and reply:\n\n${link}\n\nReplies to this email are not monitored.`},'private-message-'+messageId);
 const devices=(await db.prepare('SELECT id,endpoint FROM private_push_devices WHERE role=? AND identity=?').bind(role,recipient).all()).results||[];
 const statuses=[];
 for(const device of devices){
  if(!await eligible(db,m.team_code,m.coach_id,m.parent_email,m.organization_id)){statuses.push('suppressed');continue;}
  try{statuses.push(await sendPush(db,device,'private_push_devices'));}catch{statuses.push('unconfirmed');}
 }
 const push=devices.length?statuses.every(s=>s==='accepted')?'accepted':statuses.some(s=>s==='accepted')?'partial':'failed':'no_devices';
 await db.prepare('UPDATE private_message_notices SET status=?,email_status=?,push_status=?,updated=? WHERE message_id=?').bind('complete',email.accepted?'accepted':email.delivery,push,Date.now(),messageId).run();
 }catch{
 await db.prepare("UPDATE private_message_notices SET status='unconfirmed',updated=? WHERE message_id=?").bind(Date.now(),messageId).run();
 }
}

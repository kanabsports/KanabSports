import {CATEGORIES} from '../_lib/notification-preferences.js';
import {findBlockedWords,LANGUAGE_NOTE} from '../../assets/pep-language.mjs';
import {json} from '../_lib/coach-auth.js';
import {schema,identity,eligibleSQL,eligible,conversation,throttle,deliver} from '../_lib/private-messages.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function onRequest({request,env,waitUntil}){
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
 if(env.PRIVATE_MESSAGING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Private messaging pilot is not enabled. School messaging is unavailable.'},503);
 const db=env.SPORTS_DB,url=new URL(request.url),role=url.searchParams.get('role');
 try{
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json({error:'Open Pep to send messages.'},403);
 const actor=await identity(request,db,role);if(!actor)return json({error:`Sign in to your ${role==='coach'?'coach':'parent'} account first.`},401);
 await schema(db);
 if(request.method==='GET'){
  const id=url.searchParams.get('conversation');
  if(id){
   const c=await conversation(db,id,actor);if(!c)return json({error:'Conversation unavailable.'},404);
   const raw=url.searchParams.get('before'),before=raw===null?Number.MAX_SAFE_INTEGER:Number(raw);
   if(!Number.isSafeInteger(before)||before<1)return json({error:'Invalid page.'},400);
   const rows=(await db.prepare(`SELECT m.sequence,m.id,m.sender_role,m.sender_name,m.body,m.category,m.subject,m.created,n.status AS notification_status,n.email_status,n.push_status FROM private_messages m LEFT JOIN private_message_notices n ON n.message_id=m.id WHERE m.conversation_id=? AND m.sequence<? ORDER BY m.sequence DESC LIMIT 51`).bind(id,before).all()).results;
   const messages=rows.slice(0,50).reverse();
   return json({conversation:{id:c.id,team:c.team_name,coach:c.coach_name},messages,older:rows.length>50?messages[0].sequence:null});
  }
  const choices=actor.role==='parent'?(await db.prepare(eligibleSQL+` AND EXISTS(SELECT 1 FROM guardian_memberships g WHERE g.team_code=t.team_code AND g.email=? AND g.status='approved' AND g.expires>?) ORDER BY t.name,a.name`).bind(actor.id,Date.now()).all()).results:[];
  // Identity predicate first: no administrator or other coach bypass.
  const rows=(await db.prepare(`SELECT c.*,t.name AS team_name,a.name AS coach_name,p.name AS parent_name,(SELECT MAX(sequence) FROM private_messages WHERE conversation_id=c.id) AS latest FROM private_conversations c JOIN private_message_teams t ON t.team_code=c.team_code AND t.organization_id=c.organization_id JOIN coach_access_requests a ON a.id=c.coach_id JOIN parent_accounts p ON p.email=c.parent_email WHERE ${actor.role==='parent'?'c.parent_email':'c.coach_id'}=? ORDER BY latest DESC,c.created DESC LIMIT 200`).bind(actor.id).all()).results;
  const conversations=[];
  for(const c of rows)if(await eligible(db,c.team_code,c.coach_id,c.parent_email,c.organization_id))conversations.push({id:c.id,team:c.team_name,name:actor.role==='parent'?c.coach_name:c.parent_name});
  return json({actor:{role:actor.role,name:actor.name},choices:choices.map(c=>({team_code:c.team_code,organization_id:c.organization_id,team:c.team_name,coach_id:c.coach_id,coach:c.coach_name})),conversations,schoolMessaging:false});
 }
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>12000)return json({error:'Request too large.'},413);
 let b;try{b=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
 if(!b||typeof b!=='object')return json({error:'Invalid request.'},400);
 if(!await throttle(db,actor))return json({error:'Please wait a minute before sending more messages.'},429);
 if(b.action==='start_parent'){
  if(actor.role!=='coach'||b.audience!=='parents')return json({error:'Student accounts and parent consent are not enabled. Choose Message Parents.'},403);
  const team=String(b.team_code||''),org=String(b.organization_id||''),parent=String(b.parent_email||'').trim().toLowerCase();
  if(!await eligible(db,team,actor.id,parent,org))return json({error:'This family is not available for your team.'},403);
  await db.prepare('INSERT OR IGNORE INTO private_conversations VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),org,team,parent,actor.id,Date.now()).run();
  const c=await db.prepare('SELECT id FROM private_conversations WHERE organization_id=? AND team_code=? AND parent_email=? AND coach_id=?').bind(org,team,parent,actor.id).first();
  return json({id:c.id},201);
 }
 if(b.action==='start'){
  if(actor.role!=='parent')return json({error:'Parents choose the approved coach to start a conversation.'},403);
  const team=String(b.team_code||''),coach=String(b.coach_id||''),org=String(b.organization_id||'');
  if(!await eligible(db,team,coach,actor.id,org))return json({error:'That coach is not available for your team.'},403);
  const id=crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO private_conversations SELECT ?,t.organization_id,t.team_code,?,a.id,? FROM private_message_teams t JOIN school_teams s ON s.team_code=t.team_code JOIN private_message_coaches pc ON pc.team_code=t.team_code JOIN coach_access_requests a ON a.id=pc.coach_id WHERE t.team_code=? AND t.organization_id=? AND a.id=? AND t.enabled=1 AND pc.active=1 AND a.status='approved' AND s.kind IN ('rec','travel') AND s.school_id IS NULL AND EXISTS(SELECT 1 FROM guardian_memberships WHERE email=? AND team_code=t.team_code AND status='approved' AND expires>?)`).bind(id,actor.id,Date.now(),team,org,coach,actor.id,Date.now()).run();
  const c=await db.prepare('SELECT id FROM private_conversations WHERE organization_id=? AND team_code=? AND parent_email=? AND coach_id=?').bind(org,team,actor.id,coach).first();
  return c?json({id:c.id},201):json({error:'Access changed. Refresh and try again.'},409);
 }
 if(b.action!=='send')return json({error:'Unknown action.'},400);
 const c=await conversation(db,String(b.conversation||''),actor);if(!c)return json({error:'Conversation unavailable.'},404);
 const text=typeof b.message==='string'?b.message.trim():'',id=String(b.message_id||'');
 if(!text||text.length>4000||!uuid.test(id))return json({error:'Enter a message of 1–4,000 characters.'},400);
 if(findBlockedWords(text).length)return json({error:LANGUAGE_NOTE},422);
 const category=String(b.category||'general'),subject=String(b.subject||'').trim();
 if(!CATEGORIES.includes(category)||subject.length>120||(actor.role==='coach'&&!subject))return json({error:'Choose a topic and label what this message is about.'},400);
 if(findBlockedWords(subject).length)return json({error:LANGUAGE_NOTE},422);
 const old=await db.prepare('SELECT * FROM private_messages WHERE id=?').bind(id).first();
 if(old&&(old.conversation_id!==c.id||old.sender_role!==actor.role||old.sender_id!==actor.id||old.body!==text||old.category!==category||old.subject!==subject))return json({error:'Message retry does not match.'},409);
 // Atomic write-time authorization: revocation cannot race the initial read.
 await db.batch([
 db.prepare(`INSERT OR IGNORE INTO private_messages(id,conversation_id,sender_role,sender_id,sender_name,body,created,category,subject)
 SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_conversations c JOIN private_message_teams t ON t.team_code=c.team_code AND t.organization_id=c.organization_id JOIN school_teams s ON s.team_code=t.team_code JOIN private_message_coaches pc ON pc.team_code=c.team_code AND pc.coach_id=c.coach_id JOIN coach_access_requests a ON a.id=c.coach_id WHERE c.id=? AND t.enabled=1 AND pc.active=1 AND a.status='approved' AND s.kind IN ('rec','travel') AND s.school_id IS NULL AND EXISTS(SELECT 1 FROM guardian_memberships g WHERE g.email=c.parent_email AND g.team_code=c.team_code AND g.status='approved' AND g.expires>?))`).bind(id,c.id,actor.role,actor.id,actor.name,text,Date.now(),category,subject,c.id,Date.now()),
 db.prepare(`INSERT OR IGNORE INTO private_message_notices(message_id,updated) SELECT id,? FROM private_messages WHERE id=? AND conversation_id=? AND sender_role=? AND sender_id=? AND body=? AND category=? AND subject=?`).bind(Date.now(),id,c.id,actor.role,actor.id,text,category,subject)
 ]);
 const stored=await db.prepare('SELECT id FROM private_messages WHERE id=? AND conversation_id=? AND sender_role=? AND sender_id=? AND body=? AND category=? AND subject=?').bind(id,c.id,actor.role,actor.id,text,category,subject).first();
 if(!stored)return json({error:'Message was not saved. Refresh access and try again.'},409);
 const task=deliver(db,env,id);if(waitUntil)waitUntil(task);else await task;
 return json({id,saved:true,notificationStatus:'Check message history for provider acceptance. Acceptance does not confirm delivery.'});
 }catch{return json({error:'Private messaging is temporarily unavailable.'},503);}
}

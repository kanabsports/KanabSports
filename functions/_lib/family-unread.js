import {accessSchema,hasMembership} from './parent-access.js';
import {pilotSchema} from './pilot-schema.js';
import {allowedChannels} from './notification-preferences.js';
import {schema as privateSchema,eligible as privateEligible} from './private-messages.js';
import {schoolSchema} from './school-access.js';

export async function teamMessagesSchema(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS coach_team_messages(
  id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,team_code TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 const columns=(await db.prepare('PRAGMA table_info(coach_team_messages)').all()).results||[];
 if(!columns.some(column=>column.name==='category')){
  try{await db.prepare("ALTER TABLE coach_team_messages ADD COLUMN category TEXT NOT NULL DEFAULT 'general'").run()}
  catch(error){const current=(await db.prepare('PRAGMA table_info(coach_team_messages)').all()).results||[];if(!current.some(column=>column.name==='category'))throw error}
 }
 try{await db.prepare("UPDATE coach_team_messages SET category='schedule' WHERE category='general' AND EXISTS(SELECT 1 FROM pep_event_changes e WHERE e.team_code=coach_team_messages.team_code AND json_extract(e.event_json,'$.changeId')=coach_team_messages.id)").run()}catch{}
 try{await db.prepare('CREATE INDEX IF NOT EXISTS idx_coach_team_messages_code ON coach_team_messages(team_code,created_at)').run()}catch{}
}

export async function familyUnread(db,email,env={}){
 await accessSchema(db);await schoolSchema(db);await pilotSchema(db);await teamMessagesSchema(db);await privateSchema(db);
 const permitted=new Map(),channels=new Map();
 const canAccess=async code=>{if(!permitted.has(code))permitted.set(code,await hasMembership(db,email,code));return permitted.get(code)};
 const pushAllowed=async category=>{if(!channels.has(category))channels.set(category,(await allowedChannels(db,'parent',email,category)).push);return channels.get(category)};
 const seen=new Set();let updates=0,messages=0;
 const teamRows=(await db.prepare(`SELECT DISTINCT m.id,m.team_code,COALESCE(m.category,'general') category
  FROM coach_team_messages m JOIN guardian_memberships g ON g.team_code=m.team_code
  LEFT JOIN pep_message_receipts r ON r.team_code=m.team_code AND r.message_id=m.id AND lower(r.email)=lower(?)
  WHERE lower(g.email)=lower(?) AND g.status='approved' AND g.expires>? AND r.message_id IS NULL`).bind(email,email,Date.now()).all()).results||[];
 for(const row of teamRows){const key='update:'+row.id;if(seen.has(key)||!await canAccess(row.team_code)||!await pushAllowed(row.category))continue;seen.add(key);updates++;}
 const privateRows=(await db.prepare(`SELECT m.id,m.category,c.team_code,c.coach_id,c.parent_email,c.organization_id
  FROM private_messages m JOIN private_conversations c ON c.id=m.conversation_id
  LEFT JOIN private_message_reads r ON r.message_id=m.id AND r.role='parent' AND lower(r.identity)=lower(?)
  WHERE lower(c.parent_email)=lower(?) AND m.sender_role='coach' AND r.message_id IS NULL`).bind(email,email).all()).results||[];
 for(const row of privateRows){const key='message:'+row.id;if(seen.has(key)||!await pushAllowed(row.category)||!await privateEligible(db,row.team_code,row.coach_id,row.parent_email,row.organization_id,env))continue;seen.add(key);messages++;}
 return {unread:updates+messages,updates,messages};
}

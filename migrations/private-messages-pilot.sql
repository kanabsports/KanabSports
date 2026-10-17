-- Additive pilot tables only. No enrollment or production data changes.
CREATE TABLE IF NOT EXISTS private_message_teams(team_code TEXT PRIMARY KEY,organization_id TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),UNIQUE(team_code,organization_id));

CREATE TABLE IF NOT EXISTS private_message_coaches(team_code TEXT NOT NULL,coach_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),PRIMARY KEY(team_code,coach_id));

CREATE TABLE IF NOT EXISTS private_conversations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,team_code TEXT NOT NULL,parent_email TEXT NOT NULL,coach_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(organization_id,team_code,parent_email,coach_id));

CREATE INDEX IF NOT EXISTS private_conversations_parent ON private_conversations(parent_email,created);

CREATE INDEX IF NOT EXISTS private_conversations_coach ON private_conversations(coach_id,created);

CREATE TABLE IF NOT EXISTS private_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT NOT NULL,sender_role TEXT NOT NULL CHECK(sender_role IN ('parent','coach')),sender_id TEXT NOT NULL,sender_name TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS private_messages_history ON private_messages(conversation_id,sequence);

CREATE TABLE IF NOT EXISTS private_message_notices(message_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',email_status TEXT NOT NULL DEFAULT 'pending',push_status TEXT NOT NULL DEFAULT 'pending',updated INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS private_push_devices(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,role TEXT NOT NULL,identity TEXT NOT NULL,token_hash TEXT NOT NULL,updated INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS private_message_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);

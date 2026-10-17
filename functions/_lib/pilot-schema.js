export async function pilotSchema(db){for(const sql of [
`CREATE TABLE IF NOT EXISTS pep_pilots(id TEXT PRIMARY KEY,name TEXT NOT NULL,team_codes TEXT NOT NULL DEFAULT '[]',start_date TEXT,end_date TEXT,status TEXT NOT NULL DEFAULT 'draft')`,
`CREATE TABLE IF NOT EXISTS pep_pilot_entries(id TEXT PRIMARY KEY,pilot_id TEXT NOT NULL,date TEXT NOT NULL,kind TEXT NOT NULL,quantity INTEGER NOT NULL,note TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS pep_pilot_renewals(id TEXT PRIMARY KEY,pilot_id TEXT NOT NULL,date TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS pep_family_activity(team_code TEXT NOT NULL,family_hash TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(team_code,family_hash,day))`,
`CREATE TABLE IF NOT EXISTS pep_message_receipts(team_code TEXT NOT NULL,message_id TEXT NOT NULL,email TEXT NOT NULL,acknowledged INTEGER NOT NULL,PRIMARY KEY(team_code,message_id,email))`,
`CREATE TABLE IF NOT EXISTS pep_event_changes(team_code TEXT NOT NULL,event_id TEXT NOT NULL,event_json TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(team_code,event_id))`
])await db.prepare(sql).run()}

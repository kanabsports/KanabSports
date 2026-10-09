// Owner-authorized, one-time cleanup of the completed Bullsharks test on 2026-10-09.
// Fixed cutoff and exact team names prevent this from targeting future real teams.
const MIGRATION='2026-10-09-remove-bullsharks-test';
const CUTOFF='2026-10-09T15:12:28Z';
const NAMES=['bullshark','bullsharks','bull shark','bull sharks','bullsharks swim team','bull sharks swim team'];
const marks=a=>a.map(()=>'?').join(',');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function removeBullsharksTest(db,env={}){
 if(!db)return null;
 await db.prepare('CREATE TABLE IF NOT EXISTS pep_data_migrations(id TEXT PRIMARY KEY,completed_at TEXT NOT NULL,deleted_rows INTEGER NOT NULL)').run();
 const done=await db.prepare('SELECT deleted_rows FROM pep_data_migrations WHERE id=?').bind(MIGRATION).first();if(done)return done;
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results||[];
 const schema=new Map();
 for(const {name} of tables)if(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)&&!name.startsWith('sqlite_'))schema.set(name,new Set(((await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results||[]).map(c=>c.name)));
 const rows=async(table,sql,args=[])=>schema.has(table)?(await db.prepare(sql).bind(...args).all()).results||[]:[];
 const named=column=>`lower(trim(${quote(column)})) IN (${marks(NAMES)})`;
 const cutoff=columns=>columns.has('created_at')?' AND datetime(created_at)<=datetime(?)':'';
 const coachColumns=schema.get('coach_access_requests')||new Set();
 const nameColumns=['team_name','organization'].filter(c=>coachColumns.has(c));
 const coaches=nameColumns.length?await rows('coach_access_requests',`SELECT id${coachColumns.has('team_code')?',team_code':",NULL AS team_code"} FROM coach_access_requests WHERE (${nameColumns.map(named).join(' OR ')})${cutoff(coachColumns)}`,nameColumns.flatMap(()=>NAMES).concat(coachColumns.has('created_at')?[CUTOFF]:[])):[];
 const coachIds=coaches.map(c=>c.id);
 const codes=[];
 for(const code of new Set(coaches.map(c=>c.team_code).filter(Boolean))){const other=await db.prepare(`SELECT id FROM coach_access_requests WHERE team_code=? AND id NOT IN (${marks(coachIds)}) LIMIT 1`).bind(code,...coachIds).first();if(!other)codes.push(code);}
 const targets=new Map();
 for(const [table,columns] of schema){
  if(table==='pep_data_migrations')continue;
  const conditions=[],args=[];
  for(const col of ['coach_id','verification_id','accountable_coach_id'])if(columns.has(col)&&coachIds.length){conditions.push(`${quote(col)} IN (${marks(coachIds)})`);args.push(...coachIds)}
  if(columns.has('team_code')&&codes.length){conditions.push(`team_code IN (${marks(codes)})`);args.push(...codes)}
  if(['coach_documents','coach_submissions'].includes(table)&&columns.has('team')){conditions.push(`(${named('team')}${cutoff(columns)})`);args.push(...NAMES,...(columns.has('created_at')?[CUTOFF]:[]))}
  if(table==='coach_access_requests'&&coachIds.length){conditions.push(`id IN (${marks(coachIds)})`);args.push(...coachIds)}
  if(conditions.length)targets.set(table,{where:'('+conditions.join(' OR ')+')',args});
 }
 const ids=async(table)=>{const target=targets.get(table);return target&&schema.get(table).has('id')?(await rows(table,`SELECT id FROM ${quote(table)} WHERE ${target.where}`,target.args)).map(r=>r.id):[]};
 const documentIds=await ids('coach_documents'),assistantIds=await ids('coach_score_assistants'),messageIds=await ids('coach_team_messages'),membershipIds=await ids('guardian_memberships'),deviceIds=await ids('coach_push_devices');
 for(const [table,columns] of schema){
  for(const [col,values] of [['document_id',documentIds],['source_document_id',documentIds],['assistant_id',assistantIds],['message_id',messageIds],['membership_id',membershipIds],['device_id',deviceIds]])if(columns.has(col)&&values.length){const target=targets.get(table)||{where:'0',args:[]};target.where=`(${target.where} OR ${quote(col)} IN (${marks(values)}))`;target.args.push(...values);targets.set(table,target)}
 }
 // Cancel any queued test-driver email before deleting its receipt.
 if(targets.has('family_driver_plans')){
  const target=targets.get('family_driver_plans');const reminders=await rows('family_driver_plans',`SELECT provider_id FROM family_driver_plans WHERE ${target.where} AND status='scheduled' AND provider_id IS NOT NULL`,target.args);
  for(const reminder of reminders){if(!env.RESEND_API_KEY)throw Error('Cannot cancel scheduled test reminder');const r=await fetch(`https://api.resend.com/emails/${encodeURIComponent(reminder.provider_id)}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`}});if(!r.ok)throw Error('Provider did not confirm test reminder cancellation');}
 }
 // Delete dependents before their owning records, atomically with the migration marker.
 const last=['coach_score_assistants','guardian_memberships','coach_documents','coach_access_requests'];
 const ordered=[...targets.keys()].sort((a,b)=>(last.includes(a)?last.indexOf(a)+1:0)-(last.includes(b)?last.indexOf(b)+1:0));
 const statements=ordered.map(table=>{const t=targets.get(table);return db.prepare(`DELETE FROM ${quote(table)} WHERE ${t.where} AND NOT EXISTS(SELECT 1 FROM pep_data_migrations WHERE id=?)`).bind(...t.args,MIGRATION)});
 // Parent device registrations can include real teams too; remove only the test code.
 if(schema.get('push_devices')?.has('codes')&&codes.length)statements.push(db.prepare(`UPDATE push_devices SET codes=(SELECT json_group_array(value) FROM json_each(push_devices.codes) WHERE value NOT IN (${marks(codes)})) WHERE json_valid(codes) AND NOT EXISTS(SELECT 1 FROM pep_data_migrations WHERE id=?)`).bind(...codes,MIGRATION));
 let count=0;for(const table of ordered){const t=targets.get(table);count+=Number((await db.prepare(`SELECT count(*) n FROM ${quote(table)} WHERE ${t.where}`).bind(...t.args).first()).n)}
 statements.push(db.prepare("INSERT OR IGNORE INTO pep_data_migrations VALUES(?,datetime('now'),?)").bind(MIGRATION,count));
 await db.batch(statements);
 return await db.prepare('SELECT deleted_rows FROM pep_data_migrations WHERE id=?').bind(MIGRATION).first();
}

import {eligibleSQL,schema} from './private-messages.js';

export async function audienceSchema(db){
  await schema(db);
  for(const sql of [
    `CREATE TABLE IF NOT EXISTS pep_student_enrollments(id TEXT PRIMARY KEY,membership_id TEXT NOT NULL,organization_id TEXT NOT NULL,student_email TEXT NOT NULL,guardian_consent_ref TEXT NOT NULL,verified_teen INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pep_student_active_membership ON pep_student_enrollments(membership_id) WHERE active=1`,
    `CREATE TABLE IF NOT EXISTS pep_student_links(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pep_student_sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pep_audience_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,team_code TEXT NOT NULL,organization_id TEXT NOT NULL,enrollment TEXT NOT NULL,author_id TEXT NOT NULL,author_name TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS pep_audience_history ON pep_audience_messages(team_code,organization_id,enrollment,sequence)`
  ])await db.prepare(sql).run();
}

// A staff-only group is scoped to an explicitly enrolled team and organization.
// A joint family message additionally requires a specific current guardian
// membership and a program-verified teen with documented guardian consent.
export function channels(actor,studentEnabled){
  const base='SELECT t.team_code,t.organization_id,t.team_name,t.coach_id,';
  const from=' FROM ('+eligibleSQL+') t';
  const staff=base+"'' AS enrollment,'' AS student_ref,'' AS parent_email,'' AS student_email"+from+' WHERE t.coach_id=?';
  const family=base+'e.id AS enrollment,g.student_ref,g.email AS parent_email,e.student_email'+from+`
    JOIN pep_student_enrollments e ON e.organization_id=t.organization_id
    JOIN guardian_memberships g ON g.id=e.membership_id AND g.team_code=t.team_code
    WHERE e.active=1 AND e.verified_teen=1 AND length(trim(e.guardian_consent_ref))>0
    AND e.expires>? AND g.status='approved' AND g.expires>? AND e.student_email<>g.email AND `;
  const now=Date.now();
  const rows=[],args=[];
  if(actor.role==='coach'){rows.push(staff);args.push(actor.id);}
  if(studentEnabled){
    const field={coach:'t.coach_id',parent:'g.email',student:'e.student_email'}[actor.role];
    rows.push(family+field+'=?');args.push(now,now,actor.id);
  }
  if(!rows.length)return null;
  return {sql:rows.join(' UNION ALL '),args};
}

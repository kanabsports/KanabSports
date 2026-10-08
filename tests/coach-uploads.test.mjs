import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseCoachRoster,parseCoachSchedule} from '../assets/coach-csv.mjs';
import {ensureCoachCore,sha256} from '../functions/_lib/coach-auth.js';
import {accessSchema} from '../functions/_lib/parent-access.js';
import {schoolSchema} from '../functions/_lib/school-access.js';
import {onRequestPost as upload} from '../functions/api/coach-upload.js';
const roster='\ufeff#,Player Name,Grade,Parent/Guardian 1,Guardian 1 Phone,Guardian 1 Email,Parent/Guardian 2,Guardian 2 Phone,Guardian 2 Email\r\n1,"Jensen, Maya",8,Laura,435-555-0101,laura@example.test,Eric,435-555-0102,eric@example.test\r\n2,,,,,,,,\r\n';
const schedule='index,Date,Opponent,Time,Home/Away,Location\n0,10/17/2026,Desert Invitational,8:00 AM,Away,Sand Hollow Aquatic Center\n1,01/09/2027,Distance Meet,8:30 AM,Home,Kanab City Pool';
assert.equal(parseCoachRoster(roster).length,1);assert.equal(parseCoachRoster(roster)[0].guardians.length,2);
assert.equal(parseCoachRoster(roster)[0].student_name,'Jensen, Maya');
assert.equal(parseCoachSchedule(schedule)[1].date,'2027-01-09');assert.equal(parseCoachSchedule(schedule)[0].site,'Away · Sand Hollow Aquatic Center');
assert.throws(()=>parseCoachSchedule(schedule.replace('10/17/2026','02/30/2026')));
assert.throws(()=>parseCoachRoster(roster.replace('laura@example.test','bad-email')));
assert.throws(()=>parseCoachSchedule('Date,Opponent\n10/17/2026,Team\n10/17/2026,Team'));
const sqlite=new DatabaseSync(':memory:');const db={prepare(sql){const st=sqlite.prepare(sql);let args=[];return{bind(...v){args=v;return this},async run(){return st.run(...args)},async first(){return st.get(...args)||null},async all(){return{results:st.all(...args)}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
await ensureCoachCore(db);await schoolSchema(db);await accessSchema(db);
sqlite.prepare("INSERT INTO school_teams(team_code,kind,evidence,assigned_by) VALUES('KS-TRAVEL','travel','Synthetic test','owner')").run();
sqlite.prepare("INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status,team_code) VALUES('coach','Coach','coach@example.test','Travel Club','Swimming','Coach','approved','KS-TRAVEL')").run();
sqlite.prepare("INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES('session','coach','coach@example.test',?,datetime('now','+1 hour'))").run(await sha256('test-token'));
const env={SPORTS_DB:db,RESEND_API_KEY:'mock'},pending=[];let mails=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{assert.equal(url,'https://api.resend.com/emails');mails++;return Response.json({id:'mock'})};
async function send(type,text,cookie='ks_coach=test-token',origin='https://kanabsports.com'){
 const body=new FormData();body.set('document_type',type);body.set('season','2026–27');body.set('name','Forged coach');body.set('email','forged@example.test');body.set('schedule_json','[{"date":"2026-01-01","opponent":"Forged"}]');body.set('pdf',new File([text],'download.csv',{type:'text/csv'}));
 return upload({request:new Request('https://kanabsports.com/api/coach-upload',{method:'POST',headers:{origin,cookie},body}),env,waitUntil(p){pending.push(p)}});
}
try{
 assert.equal((await send('Roster',roster,'')).status,400);
 assert.equal((await send('Roster',roster,undefined,'https://other.example')).status,403);
 let r=await send('Roster',roster);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).rows,1);
 const saved=JSON.parse(sqlite.prepare('SELECT payload_json FROM coach_roster_uploads').get().payload_json);assert.match(saved[0].student_ref,/^PEP-/);assert.equal(saved[0].guardians[1].email,'eric@example.test');
 assert.equal(sqlite.prepare('SELECT name FROM coach_documents').get().name,'Coach');assert.equal(sqlite.prepare('SELECT status FROM coach_documents').get().status,'pending');
 assert.equal(sqlite.prepare('SELECT count(*) n FROM guardian_memberships').get().n,0);
 r=await send('Schedule',schedule);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).rows,2);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM coach_schedule_games').get().n,2);assert.equal(sqlite.prepare('SELECT opponent FROM coach_schedule_games ORDER BY date LIMIT 1').get().opponent,'Desert Invitational');
 assert.equal((await send('Schedule',schedule.replace('10/17/2026','invalid'))).status,400);assert.equal(mails,2);
 sqlite.prepare("UPDATE school_teams SET kind='school'").run();assert.equal((await send('Roster',roster)).status,403);sqlite.prepare("UPDATE school_teams SET kind='travel'").run();
 globalThis.fetch=async()=>{throw Error('Synthetic network failure')};assert.equal((await send('Roster',roster)).status,502);assert.equal(sqlite.prepare('SELECT count(*) n FROM coach_roster_uploads').get().n,1);assert.equal(sqlite.prepare('SELECT count(*) n FROM coach_documents').get().n,2);
 await Promise.all(pending);console.log('PASS: downloaded CSV headers, two guardians, dates and locations, invalid data, authenticated uploads, school gate, saved private roster, pending review, no parent auto-enrollment, server-side parsing, failed notification cleanup. No external messages sent.');
}finally{globalThis.fetch=originalFetch;sqlite.close()}

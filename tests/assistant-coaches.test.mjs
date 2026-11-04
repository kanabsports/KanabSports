import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureCoachCore,sha256,getCoach} from '../functions/_lib/coach-auth.js';
import {assistantCoachSchema} from '../functions/_lib/assistant-coaches.js';
import {passId} from '../functions/_lib/travel-pass.js';
import {onRequest as manage} from '../functions/api/assistant-coaches.js';
import {onRequest as announcements} from '../functions/api/coach-messages.js';
import {onRequestPost as score} from '../functions/api/coach-submit.js';
import {onRequestPost as account} from '../functions/api/coach-account.js';

const sqlite=new DatabaseSync(':memory:');
const db={prepare(sql){const st=sqlite.prepare(sql);let args=[];return {
  bind(...values){args=values;return this},async run(){return st.run(...args)},
  async first(){return st.get(...args)||null},async all(){return {results:st.all(...args)}}};
},async batch(statements){sqlite.exec('SAVEPOINT d1_batch');try{const rows=await Promise.all(statements.map(s=>s.run()));sqlite.exec('RELEASE d1_batch');return rows}catch(e){sqlite.exec('ROLLBACK TO d1_batch; RELEASE d1_batch');throw e}}};
const origin='https://kanabsports.com',env={SPORTS_DB:db,RESEND_API_KEY:'fixture'};
await ensureCoachCore(db);await assistantCoachSchema(db);
for(const [id,code,role,kind] of [[passId,'TEAM-A','Head Coach','travel'],['other','TEAM-B','Head Coach','travel'],['school','TEAM-C','Head Coach','school'],['existing-assistant','TEAM-A','Assistant Coach','travel']]) {
  sqlite.prepare(`INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status,team_name,team_code,reviewed_at,review_token_hash)
    VALUES(?,?,?,'Travel','Basketball',?,'approved',?,?,datetime('now'),?)`).run(id,id,id+'@example.test',role,code,code,id===passId?'owner-pending':null);
  sqlite.prepare("INSERT OR IGNORE INTO school_teams(team_code,kind,evidence,assigned_by) VALUES(?,?,'fixture','fixture')").run(code,kind);
  sqlite.prepare("INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES(?,?,?, ?,datetime('now','+1 day'))").run(id,id,id+'@example.test',await sha256(id));
}
const mail=[];let sendFails=false;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mail.push(JSON.parse(options.body));return sendFails?Response.json({name:'validation_error'},{status:400}):Response.json({id:'fixture-'+mail.length})};
function request(path,body,cookie=passId,site=origin){return new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:site,'Content-Type':'application/json',cookie:'ks_coach='+cookie},body:body?JSON.stringify(body):undefined})}
const call=(body,cookie=passId,site=origin)=>manage({env,request:request('/api/assistant-coaches',body,cookie,site)});
const invite={action:'invite',name:'Fixture Assistant',email:'assistant@example.test'};
const latestToken=()=>mail.at(-1).text.match(/#invite=([a-f0-9]{64})/)[1];
const latestInvite=()=>sqlite.prepare('SELECT * FROM coach_assistant_invites ORDER BY rowid DESC LIMIT 1').get();
const password='a fixture password';
const auth=(body)=>account({env,request:request('/api/coach-account',body,'')});
assert.equal((await call(undefined,'unknown')).status,401);
assert.equal((await call(invite,'existing-assistant')).status,403);
assert.equal((await call(invite,'school')).status,403);
assert.equal((await call(invite,passId,'https://unrelated.example')).status,403);
assert.equal((await call({...invite,email:'bad'})).status,400);
let response=await call(invite);assert.equal(response.status,200,await response.clone().text());
const row=latestInvite(),token=latestToken();
assert.equal(row.token_hash,await sha256(token));assert.equal(row.status,'sent');
assert.equal(mail.at(-1).to[0],invite.email);assert.equal(mail.at(-1).reply_to,passId+'@example.test');
assert.equal((await call(invite)).status,409);
assert.equal((await call({action:'revoke',id:row.id},'other')).status,404);
assert.equal((await call({action:'preview',token},'')).status,200);assert.equal(latestInvite().status,'sent');
assert.equal((await call({action:'accept',token,password:'short'},'')).status,400);
response=await call({action:'accept',token,password,role:'Head Coach',team_code:'TEAM-B'},'');
assert.equal(response.status,200,await response.clone().text());
const accepted=await response.json(),cookie=response.headers.get('set-cookie').match(/ks_coach=([^;]+)/)[1];
const assistant=sqlite.prepare('SELECT * FROM coach_access_requests WHERE id=?').get(accepted.coachId);
assert.equal(assistant.role,'Assistant Coach');assert.equal(assistant.team_code,'TEAM-A');
assert.equal(latestInvite().token_hash,null);assert.equal(latestInvite().status,'accepted');
assert.equal((await call({action:'accept',token,password},'')).status,410);
assert.equal((await call({...invite,email:'further@example.test'},cookie)).status,403);
response=await announcements({env,request:request('/api/coach-messages',{action:'post',body:'Practice at five tomorrow.'},cookie)});
assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).teamCode,'TEAM-A');
assert.equal(sqlite.prepare('SELECT author FROM coach_team_messages').get().author,invite.name);
const scoreForm=new FormData();for(const [key,value] of Object.entries({type:'Score',date:'2026-11-06',result:'48–36',opponent:'Fictional visitors'}))scoreForm.set(key,value);
response=await score({env,request:new Request(origin+'/api/coach-submit',{method:'POST',headers:{cookie:'ks_coach='+cookie},body:scoreForm})});
assert.equal(response.status,200,await response.clone().text());
assert.equal(sqlite.prepare('SELECT accountable_coach_id FROM coach_submissions').get().accountable_coach_id,accepted.coachId);
assert.equal((await auth({action:'login',email:invite.email,password,coachId:accepted.coachId})).status,200);
sqlite.exec('SAVEPOINT joined');
sqlite.prepare("UPDATE coach_access_requests SET reviewed_at=datetime('now','-73 hours') WHERE id=?").run(passId);
assert.equal(await getCoach(request('/api/coach-profile',null,cookie),db),null);
assert.equal((await auth({action:'login',email:invite.email,password})).status,403);
sqlite.prepare('UPDATE coach_access_requests SET review_token_hash=NULL WHERE id=?').run(passId);
assert(await getCoach(request('/api/coach-profile',null,cookie),db));
sqlite.prepare("UPDATE coach_access_requests SET status='rejected' WHERE id=?").run(passId);
assert.equal(await getCoach(request('/api/coach-profile',null,cookie),db),null);
sqlite.exec('ROLLBACK TO joined');
assert.equal((await call({action:'revoke',id:row.id})).status,200);
assert.equal(await getCoach(request('/api/coach-profile',null,cookie),db),null);
assert.equal((await auth({action:'login',email:invite.email,password})).status,403);
// Failed delivery grants no access; resend rotates the token, and old links stay invalid.
sendFails=true;response=await call({...invite,email:'next@example.test'});assert.equal(response.status,502);
assert.equal(latestInvite().status,'failed');assert.equal(latestInvite().token_hash,null);
sendFails=false;sqlite.prepare("UPDATE coach_assistant_invites SET updated_at=datetime('now','-1 minute') WHERE id=?").run(latestInvite().id);
response=await call({action:'resend',id:latestInvite().id});assert.equal(response.status,200,await response.clone().text());
const second=latestInvite(),oldToken=latestToken();
sqlite.prepare("UPDATE coach_assistant_invites SET updated_at=datetime('now','-1 minute') WHERE id=?").run(second.id);
assert.equal((await call({action:'resend',id:second.id})).status,200);
assert.equal((await call({action:'preview',token:oldToken},'')).status,410);
const newToken=latestToken();
sqlite.prepare("UPDATE coach_assistant_invites SET expires_at=datetime('now','-1 hour') WHERE id=?").run(second.id);
assert.equal((await call({action:'accept',token:newToken,password},'')).status,410);
// A revoked sponsor cannot activate an invitation, even if the email link is valid.
assert.equal((await call({...invite,email:'blocked@example.test'})).status,200);const blocked=latestToken();
sqlite.prepare("UPDATE coach_access_requests SET status='rejected' WHERE id=?").run(passId);
assert.equal((await call({action:'accept',token:blocked,password},'')).status,410);
console.log('PASS assistant invitation, mailbox link, exact team/role, existing coach login, announcements, score submission, resend, expiry, rejection and immediate revocation. All email mocked; all data fictional.');

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureCoachCore,sha256} from '../functions/_lib/coach-auth.js';
import {invitationSchema,sendEmail} from '../functions/_lib/score-invitations.js';
import {onRequest as manage} from '../functions/api/score-assistants.js';
import {onRequest as submit} from '../functions/api/score-assistant-submit.js';
import {onRequest as review} from '../functions/score-assistant-review.js';
const sqlite=new DatabaseSync(':memory:');
const db={prepare(sql){const st=sqlite.prepare(sql);let args=[];return{bind(...v){args=v;return this},async run(){return st.run(...args)},async first(){return st.get(...args)||null},async all(){return {results:st.all(...args)}}}}};
await ensureCoachCore(db);await invitationSchema(db);
for(const [id,role,code] of [['coach','Head Coach','TEAM-A'],['other','Head Coach','TEAM-B'],['same','Head Coach','TEAM-A'],['assistant','Assistant Coach','TEAM-A']]){
 sqlite.prepare("INSERT INTO coach_access_requests(id,name,email,phone,organization,sport,role,status,team_code) VALUES(?,?,'coach@example.test','+14355550101','Synthetic Club','Swimming',?,'approved',?)").run(id,id,role,code);
 sqlite.prepare("INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES(?,?,'coach@example.test',?,datetime('now','+1 hour'))").run(id,id,await sha256(id));
}
const env={SPORTS_DB:db,RESEND_API_KEY:'mock'},original=globalThis.fetch;let messages=[],failure=false,reviewToken='';
globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');const payload=JSON.parse(opts.body);messages.push(payload);if(payload.text.includes('Review score:'))reviewToken=payload.text.match(/token=([a-f0-9]+)/)[1];return failure?Response.json({name:'validation_error',message:'Secret must not be displayed'}, {status:403}):Response.json({id:'mock-'+messages.length})};
async function call(body,who='coach'){return manage({env,request:new Request('https://example.test/api/score-assistants',{method:body?'POST':'GET',headers:{cookie:'ks_coach='+who,origin:'https://example.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})})}
async function score(body){return submit({env,request:new Request('https://example.test/api/score-assistant-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})}
const invite={action:'add',name:'Synthetic Assistant',email:'assistant@example.test',trusted:false};
try{
 let r=await call({action:'test_email'});assert.equal(r.status,200);assert.equal(messages.at(-1).to[0],'coach@example.test');
 assert.equal((await call(invite,'assistant')).status,403);assert.equal((await call({...invite,name:''})).status,400);
 r=await call(invite);assert.equal(r.status,200,await r.clone().text());let row=sqlite.prepare('SELECT * FROM coach_score_assistants').get();assert.equal(row.status,'sent');assert.ok(row.provider_message_id);let token=messages.at(-1).text.match(/token=([a-f0-9]+)/)[1];assert.equal(row.invite_token_hash,await sha256(token));assert.ok(!(await r.text()).includes(token));
 assert.equal((await call(invite)).status,409);assert.equal((await call(invite,'same')).status,409);assert.equal((await call(invite,'other')).status,200);
 assert.equal((await score({token,date:'2026-10-09',opponent:'Synthetic Opponent',result:'1-0'})).status,403);
 assert.equal((await score({token,action:'accept'})).status,200);assert.equal(sqlite.prepare('SELECT status FROM coach_score_assistants WHERE id=?').get(row.id).status,'accepted');
 r=await score({token,date:'2026-10-09',opponent:'Synthetic Opponent',result:'1-0'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).status,'pending');
 let saved=sqlite.prepare('SELECT * FROM coach_submissions').get();assert.equal(saved.status,'pending');assert.equal(saved.accountable_coach_id,'coach');assert.equal(saved.assistant_id,row.id);assert.equal(saved.published_at,null);
 // Acceptance token cannot sign in as a coach.
 assert.equal((await call(undefined,token)).status,401);
 // Authorized coach approval publishes only in this in-memory database.
 const form=new FormData();form.set('token',reviewToken);form.set('action','approve');
 r=await review({env,request:new Request('https://example.test/score-assistant-review',{method:'POST',body:form})});assert.equal(r.status,200,await r.clone().text());assert.equal(sqlite.prepare('SELECT status FROM coach_submissions').get().status,'approved');
 assert.equal((await call({action:'update_trust',id:row.id,trusted:true,trust_acknowledged:true})).status,200);
 r=await score({token,date:'2026-10-10',opponent:'Synthetic Opponent',result:'2-0'});assert.equal((await r.json()).status,'published');
 assert.equal((await call({action:'cancel',id:row.id},'other')).status,404);assert.equal(sqlite.prepare('SELECT status FROM coach_score_assistants WHERE id=?').get(row.id).status,'accepted');
 assert.equal((await call({action:'cancel',id:row.id})).status,200);assert.equal((await score({token,action:'accept'})).status,403);
 failure=true;r=await call(invite);assert.equal(r.status,502);row=sqlite.prepare("SELECT * FROM coach_score_assistants WHERE status='failed'").get();assert.ok(row);assert.equal(row.invite_token_hash,null);assert.ok(!row.last_error.includes('Secret'));
 assert.equal((await call({action:'test_email'})).status,502);
 failure=false;r=await call({action:'resend',id:row.id});assert.equal(r.status,200,await r.clone().text());token=messages.at(-1).text.match(/token=([a-f0-9]+)/)[1];const firstHash=sqlite.prepare('SELECT invite_token_hash FROM coach_score_assistants WHERE id=?').get(row.id).invite_token_hash;
 assert.equal((await call({action:'resend',id:row.id})).status,200);assert.notEqual(sqlite.prepare('SELECT invite_token_hash FROM coach_score_assistants WHERE id=?').get(row.id).invite_token_hash,firstHash);assert.equal((await score({token,action:'accept'})).status,403);

 globalThis.fetch=async(url)=>{assert.match(url,/mock-/);return Response.json({last_event:'bounced'})};
 assert.equal((await call({action:'check_delivery',id:row.id})).status,502);assert.equal(sqlite.prepare('SELECT status FROM coach_score_assistants WHERE id=?').get(row.id).status,'failed');
 globalThis.fetch=async()=>Response.json({id:'mock-resend'});assert.equal((await call({action:'resend',id:row.id})).status,200);
 globalThis.fetch=async()=>Response.json({last_event:'delivered'});assert.equal((await call({action:'check_delivery',id:row.id})).status,200);
 globalThis.fetch=async()=>Response.json({id:'mock-resend'});
 sqlite.prepare("UPDATE coach_score_assistants SET invite_expires_at=datetime('now','-1 day') WHERE id=?").run(row.id);await call();assert.equal(sqlite.prepare('SELECT status FROM coach_score_assistants WHERE id=?').get(row.id).status,'expired');assert.equal((await call({action:'resend',id:row.id})).status,200);
 globalThis.fetch=async()=>Response.json({});assert.equal((await sendEmail(env,{to:['coach@example.test']},'test')).accepted,false);
 globalThis.fetch=async()=>{throw Error('network')};assert.equal((await sendEmail(env,{},'test')).accepted,false);
 console.log('PASS: test email acceptance/rejection, validation, role checks, provider IDs, hashed tokens, acceptance gate, team-scoped duplicates, tenant isolation, approval and immediate publishing, audit records, resend rotation, revoke, expiration, malformed provider response and network failure. All email requests mocked; scores only in memory.');
}finally{globalThis.fetch=original;sqlite.close()}

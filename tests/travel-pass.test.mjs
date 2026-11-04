import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {passId,matchesPass,expirePass} from '../functions/_lib/travel-pass.js';
import {onRequestPost as signup} from '../functions/coach-register.js';
import {onRequestPost as account,onRequestGet as session} from '../functions/api/coach-account.js';
import {onRequest as review} from '../functions/coach-access-review.js';
import {onRequestPost as score} from '../functions/api/coach-submit.js';
const root='https://kanabsports.com',email='fixture@example.test';
const sqlite=new DatabaseSync(':memory:');

const db={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async run(){return statement.run(...args)},async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}}}},async batch(statements){sqlite.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};

const env={SPORTS_DB:db,RESEND_API_KEY:'test',TURNSTILE_SECRET_KEY:'test'};
const mail=[],tasks=[];
globalThis.fetch=async(url,opts)=>{
 if(String(url).includes('turnstile'))return Response.json({success:true});
 assert.equal(url,'https://api.resend.com/emails');mail.push(JSON.parse(opts.body));return Response.json({id:'mock'});
};
// Substitute a fictional mailbox for the private invitation in this test only.
const digest=crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest=async (alg,bytes)=>new TextDecoder().decode(bytes)===email
 ?Uint8Array.from(Buffer.from('5bcb341b313ba840fc0fbc94ea81546bdf7c8b51cd359ab18bb555ed1a56a2f2','hex')).buffer:digest(alg,bytes);
const req=(url,body)=>new Request(root+url,{method:'POST',headers:{Origin:root},body});
const auth=b=>account({request:req('/api/coach-account',JSON.stringify({...b,email})),env});
const record=()=>sqlite.prepare('SELECT * FROM coach_access_requests WHERE id=?').get(passId);
assert(await matchesPass(email.toUpperCase(),'Travel','Girls Basketball'));
assert(!await matchesPass('other@example.test','Travel','Basketball'));assert(!await matchesPass(email,'KHS','Basketball'));
const form=new FormData();
for(const [k,v] of Object.entries({name:'Coach Example',email:email.toUpperCase(),organization:'Travel',team_name:'Fictional Team',role:'Head Coach',sport:'Basketball',phone:'4355550101','cf-turnstile-response':'test'}))form.set(k,v);
const register=()=>signup({request:req('/coach-register',form),env,waitUntil:t=>tasks.push(t)});
assert((await (await register()).json()).inviteSetup);await Promise.all(tasks);
assert.equal(record().status,'pending');assert.equal(mail[0].to[0],'howdy@kanabsports.com');assert.match(mail[0].text,/72 hours/);
const token=new URL(mail[0].text.match(/https:\/\/[^\s]+action=approve/)[0]).searchParams.get('token');
const decision=action=>{const b=new FormData();b.set('token',token);b.set('action',action);return review({request:req('/coach-access-review',b),env});};
assert.equal((await auth({action:'set_password',password:'fixture-passphrase',otp:'invalid'})).status,400);assert.equal(record().status,'pending');
async function setup(){assert.equal((await auth({action:'request_otp'})).status,200);const otp=mail.at(-1).text.match(/code is (\d{6})/)[1];return auth({action:'set_password',password:'fixture-passphrase',otp});}
const first=await setup();assert.equal(first.status,200,await first.clone().text());const cookie=first.headers.get('Set-Cookie').split(';')[0],accepted=record();
assert.equal(accepted.status,'approved');assert(accepted.review_token_hash);assert.match(accepted.team_code,/^KS-[A-Z0-9]{6}$/);
assert.equal(sqlite.prepare('SELECT kind FROM school_teams WHERE team_code=?').get(accepted.team_code).kind,'travel');
assert(sqlite.prepare("SELECT 1 FROM coach_sessions WHERE expires_at=datetime(?,'+72 hours')").get(accepted.reviewed_at));
const current=async cookie=>(await (await session({request:new Request(root+'/api/coach-account',{headers:{cookie}}),env})).json()).authenticated;
assert(await current(cookie));
const b=new FormData();for(const [k,v] of Object.entries({type:'Score',date:'2026-11-06',opponent:'Sample team',result:'48–36'}))b.set(k,v);
const result=await score({request:new Request(root+'/api/coach-submit',{method:'POST',headers:{cookie},body:b}),env,waitUntil:t=>tasks.push(t)});
assert.equal(result.status,200,await result.clone().text());assert((await result.json()).published);assert.equal(sqlite.prepare("SELECT result FROM coach_submissions WHERE accountable_coach_id=? AND status='approved'").get(passId).result,'48–36');
sqlite.exec('SAVEPOINT active');
assert.equal((await decision('approve')).status,200);assert(await current(cookie));assert.equal(record().review_token_hash,null);assert.equal(record().team_code,accepted.team_code);assert.equal((await decision('reject')).status,404);
sqlite.exec('ROLLBACK TO active');
assert.equal((await decision('reject')).status,200);assert(!await current(cookie));assert.equal(record().status,'rejected');
sqlite.exec('ROLLBACK TO active');
sqlite.prepare("UPDATE coach_access_requests SET reviewed_at=datetime('now','-73 hours') WHERE id=?").run(passId);
sqlite.exec("UPDATE coach_sessions SET expires_at=datetime('now','-1 hour')");
assert(!await current(cookie));assert.equal((await auth({action:'login',password:'fixture-passphrase'})).status,403);
await expirePass(db);assert.equal(record().status,'pass_expired');assert.equal((await register()).status,409);
assert.equal((await decision('approve')).status,200);assert.equal(record().status,'approved');assert.equal((await auth({action:'login',password:'fixture-passphrase'})).status,200);
console.log('PASS travel invitation, mailbox verification, review email, actual coach score handler, approval, rejection, 72-hour expiry and no renewal on resubmission.');

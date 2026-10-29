import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL(path,import.meta.url),'utf8')).toString('base64'));
const core=readFileSync(new URL('../functions/_lib/coach-auth.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../functions/api/coach-account.js',import.meta.url),'utf8').replace("'../_lib/coach-auth.js'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(core).toString('base64')));
const coach=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const auth=await load('../functions/api/admin-auth.js'),dashboard=await load('../functions/api/admin-dashboard.js');
const sql=new DatabaseSync(':memory:');
const db={prepare(query){return {args:[],bind(...args){this.args=args;return this},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:r.changes}}},async first(){return sql.prepare(query).get(...this.args)},async all(){return {results:sql.prepare(query).all(...this.args)}}}}};
const postCoach=(action,email,password='A test password 123')=>coach.onRequestPost({request:new Request('https://kanabsports.com/api/coach-account',{method:'POST',headers:{Origin:'https://kanabsports.com','Content-Type':'application/json'},body:JSON.stringify({action,email,password,otp:'123456'})}),env:{SPORTS_DB:db,RESEND_API_KEY:'test'}});
for(const action of ['login','request_otp','set_password']){
 const response=await postCoach(action,' HOWDY@KANABSPORTS.COM ');
 assert.equal(response.status,409);assert.equal((await response.json()).redirect,'/admin.html');assert.equal(response.headers.get('Set-Cookie'),null);
}
const other=await postCoach('login','another@example.com');assert.equal(other.status,403);assert.equal((await other.json()).redirect,undefined);
// Save an owner password through an authenticated owner session, then sign in
// through the actual password verifier against that persisted database record.
await auth.onRequestGet({request:new Request('https://kanabsports.com/api/admin-auth'),env:{SPORTS_DB:db}});
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('existing-session'))).toString('hex');
sql.prepare("INSERT INTO admin_sessions VALUES ('owner','howdy@kanabsports.com',?,'2099-01-01',CURRENT_TIMESTAMP)").run(hash);
const save=await dashboard.onRequestPost({request:new Request('https://kanabsports.com/api/admin-dashboard',{method:'POST',headers:{Cookie:'ks_admin=existing-session','Content-Type':'application/json'},body:JSON.stringify({action:'set_password',password:'Owner test password 123!'})}),env:{SPORTS_DB:db}});
assert.equal((await save.json()).success,true);
const actualFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:true})};
try{
 const login=async password=>auth.onRequestPost({request:new Request('https://kanabsports.com/api/admin-auth',{method:'POST',body:new URLSearchParams({action:'login',email:'howdy@kanabsports.com',password,'cf-turnstile-response':'test-verification'})}),env:{SPORTS_DB:db,RESEND_API_KEY:'test',TURNSTILE_SECRET_KEY:'test'}});
 const response=await login('Owner test password 123!');assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/^ks_admin=.*HttpOnly; Secure/);assert.equal((await response.json()).success,true);
 assert.equal((await login('incorrect password')).status,403);
}finally{globalThis.fetch=actualFetch}
// An approved coach using the owner email keeps their separate coach login.
sql.prepare("INSERT INTO coach_access_requests (id,name,email,organization,sport,role,status) VALUES ('coach','Jeff','howdy@kanabsports.com','Kanab','Soccer','Coach','approved')").run();
const enrolled=await postCoach('login','howdy@kanabsports.com');assert.equal(enrolled.status,403);assert.equal((await enrolled.json()).redirect,undefined);
console.log('PASS: missing Howdy coach routes to owner for login/setup/reset without issuing a session; other coaches unchanged; owner password persists and signs in; wrong password rejected; approved Howdy coach remains supported.');

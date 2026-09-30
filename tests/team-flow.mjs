import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {onRequest as account} from '../functions/api/team-d-account.js';
import {onRequest as workspace} from '../functions/api/team-workspace.js';
import {onRequestGet as roster} from '../functions/api/britt-roster.js';
import {onRequestGet as smsGet,onRequestPost as smsPost} from '../functions/api/twilio-inbound.js';
import {onRequestPost as legacyLogin} from '../functions/api/britt-login.js';
import {onRequest as parent} from '../functions/api/parent-account.js';
const emails={coach:process.env.TEST_COACH_EMAIL,head:process.env.TEST_HEAD_EMAIL};
if(!emails.coach||!emails.head)throw Error('Provide configured pilot emails through TEST_COACH_EMAIL and TEST_HEAD_EMAIL.');
const sqlite=new DatabaseSync(':memory:');
class DB{prepare(sql){return new Statement(sql)}async batch(statements){sqlite.exec('BEGIN');try{const r=await Promise.all(statements.map(s=>s.run()));sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}}
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return sqlite.prepare(this.sql).get(...this.args)||null}async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}async run(){return sqlite.prepare(this.sql).run(...this.args)}}
const env={SPORTS_DB:new DB(),RESEND_API_KEY:'test-only',TWILIO_AUTH_TOKEN:'test-token'};
const sent=[];globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return new Response('{}',{status:200})};
async function call(handler,path,{body,cookie,method,extraHeaders={}}={}){const req=new Request('https://kanabsports.com'+path,{method:method|| (body?'POST':'GET'),headers:{Origin:'https://kanabsports.com',...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extraHeaders},body:body?JSON.stringify(body):undefined});const pending=[];const res=await handler({request:req,env,waitUntil:p=>pending.push(p)});await Promise.all(pending);return res;}
async function signIn(email){const request=await call(account,'/api/team-d-account',{body:{action:'request_code',email}});assert.equal(request.status,200);const {challenge}=await request.json();const code=sent.at(-1).text.match(/code is: (\d{8})/)[1];const verify=await call(account,'/api/team-d-account',{body:{action:'verify',challenge,code}});assert.equal(verify.status,200);const cookie=verify.headers.get('set-cookie').split(';')[0];assert.equal((await call(account,'/api/team-d-account',{body:{action:'verify',challenge,code}})).status,403);return cookie;}
const coach=await signIn(emails.coach);
assert.equal((await (await call(account,'/api/team-d-account',{cookie:coach})).json()).member.status,'pending');
assert.equal((await call(roster,'/api/britt-roster',{cookie:coach})).status,401);
assert.equal((await call(roster,'/api/britt-roster',{cookie:'britt_coach_session=fake'})).status,401);
assert.equal((await call(legacyLogin,'/api/britt-login',{body:{password:'britt'}})).status,410);
assert.equal((await call(workspace,'/api/team-workspace',{cookie:coach,body:{action:'announce',body:'Premature'}})).status,403);
const head=await signIn(emails.head);
assert.equal(sent.filter(x=>x.subject.includes('joined Team D')).length,1);
await call(account,'/api/team-d-account',{cookie:head});
assert.equal(sent.filter(x=>x.subject.includes('joined Team D')).length,1,'Signup email must not repeat after refresh');
assert.equal((await call(workspace,'/api/team-workspace',{cookie:head,body:{action:'review',coachId:'britt',status:'approved'}})).status,200);
assert.equal((await call(workspace,'/api/team-workspace',{cookie:coach,body:{action:'review',coachId:'jodi',status:'approved'}})).status,403);
const rosterResult=await call(roster,'/api/britt-roster',{cookie:coach});assert.equal(rosterResult.status,200);assert.equal((await rosterResult.json()).players.length,11);
assert.equal((await call(workspace,'/api/team-workspace',{cookie:coach,body:{action:'announce',body:'Practice moved to 5:30. <script>test</script>'}})).status,200);
const pub=await (await call(workspace,'/api/team-workspace?view=public')).json();assert.equal(pub.announcements.length,1);assert.equal(pub.announcements[0].author,'Britt Roth');assert.equal(pub.coaches,undefined);assert.equal(pub.member,undefined);
assert.equal((await call(workspace,'/api/team-workspace')).status,401);
assert.equal((await call(workspace,'/api/team-workspace',{cookie:head,body:{action:'review',coachId:'britt',status:'denied'}})).status,200);
assert.equal((await call(roster,'/api/britt-roster',{cookie:coach})).status,401);
assert.equal((await call(smsGet,'/api/twilio-inbound?phone=unrelated')).status,401);
const form={Body:'JOIN',From:'+15005550006'},url='https://kanabsports.com/api/twilio-inbound';
let payload=url;for(const k of Object.keys(form).sort())payload+=k+form[k];const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(payload).digest('base64');
const req=sig=>new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':sig},body:new URLSearchParams(form)});
assert.equal((await smsPost({request:req('forged'),env})).status,403);
const good=await smsPost({request:req(signature),env});assert.equal(good.status,200);assert.match(await good.text(),/full parent\/guardian name/);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sms_enrollment').get().n,1);
// Parent family replacement is transactional and rejects duplicate entry IDs.
const parentEmail='test-parent@example.invalid';
const start=await call(parent,'/api/parent-account',{body:{action:'request_code',email:parentEmail,name:'Test Parent'}});const challenge=(await start.json()).challenge;const code=sent.at(-1).text.match(/code is: (\d{8})/)[1];const login=await call(parent,'/api/parent-account',{body:{action:'verify',challenge,code}});const pc=login.headers.get('set-cookie').split(';')[0];
const entry={entry_id:'one',team_code:'TEAM-D',child_name:'Kid 1',created:1};
assert.equal((await call(parent,'/api/parent-account',{cookie:pc,body:{action:'save_family',entries:[entry]}})).status,200);
assert.equal((await call(parent,'/api/parent-account',{cookie:pc,body:{action:'save_family',entries:[entry,entry]}})).status,400);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM parent_family').get().n,1);
console.log('PASS: OTP replay, pending/approved/revoked access, head-only approval, single signup email, public update feed, roster privacy, legacy-login retirement, webhook signatures and atomic family saves.');

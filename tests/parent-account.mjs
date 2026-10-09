import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/parent-account.js';
const sql=new DatabaseSync(':memory:');
class Statement{constructor(query,args=[]){this.query=query;this.args=args}bind(...args){return new Statement(this.query,args)}async first(){return sql.prepare(this.query).get(...this.args)}async all(){return{results:sql.prepare(this.query).all(...this.args)}}async run(){return sql.prepare(this.query).run(...this.args)}}
const db={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={SPORTS_DB:db,RESEND_API_KEY:'test-only'},mail=[];
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mail.push(JSON.parse(options.body));return new Response('{}',{status:200})};
const realNow=Date.now;let now=1800000000000;Date.now=()=>now;
async function call(body,cookie='',origin='https://kanabsports.com',customEnv=env){const response=await onRequest({env:customEnv,request:new Request('https://kanabsports.com/api/parent-account',{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':'192.0.2.1'},body:body?JSON.stringify(body):undefined})});return{status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0],headers:response.headers}}
async function challenge(email){const r=await call({action:'request_code',email,name:'Test Parent'});assert.equal(r.status,200);return{action:'verify',challenge:r.data.challenge,code:mail.at(-1).text.match(/code is: (\d{8})/)[1]}}
assert.equal((await call()).data.signedIn,false);
assert.equal((await call({action:'login_pin',email:'a@example.test',pin:'123456'},'','https://evil.test')).status,403);
const aChallenge=await challenge('a@example.test');
assert.equal((await call({...aChallenge,pin:'12345'})).status,400);
const a=await call({...aChallenge,pin:'012345'});assert.equal(a.status,200);assert(a.headers.get('Set-Cookie').includes('HttpOnly'));assert.equal((await call(aChallenge)).status,403);
let stored=sql.prepare('SELECT * FROM parent_pins WHERE email=?').get('a@example.test');assert.notEqual(stored.hash,'012345');assert.equal(stored.hash.length,64);assert.equal(stored.salt.length,64);
assert.equal((await call({action:'save_family',entries:[{entry_id:'kid-a',team_code:'KANAB-HS',child_name:'Sample A',created:now}]},a.cookie)).status,200);
const b=await call({...await challenge('b@example.test'),pin:'654321'});assert.equal(b.status,200);
assert.equal((await call({action:'save_family',entries:[{entry_id:'kid-b',team_code:'KS-FICTIONAL',child_name:'Sample B',created:now}]},b.cookie)).status,200);
const newDevice=await call({action:'login_pin',email:'A@EXAMPLE.TEST',pin:'012345'},'','https://kanabsports.com',{SPORTS_DB:db});assert.equal(newDevice.status,200);
let family=await call(undefined,newDevice.cookie);assert.equal(family.data.account.email,'a@example.test');assert.deepEqual(family.data.family.map(x=>x.child_name),['Sample A']);assert.deepEqual((await call(undefined,b.cookie)).data.family.map(x=>x.child_name),['Sample B']);
const incorrect=await call({action:'login_pin',email:'a@example.test',pin:'999999'}),missing=await call({action:'login_pin',email:'missing@example.test',pin:'999999'});assert.equal(incorrect.status,403);assert.deepEqual(incorrect.data,missing.data);
const reset=await call({...await challenge('a@example.test'),pin:'987654'});assert.equal(reset.status,200);assert.equal((await call(undefined,a.cookie)).data.signedIn,false);assert.equal((await call(undefined,newDevice.cookie)).data.signedIn,false);assert.equal((await call(undefined,b.cookie)).data.signedIn,true);assert.equal((await call(undefined,reset.cookie)).data.family[0].child_name,'Sample A');assert.notEqual(sql.prepare('SELECT salt FROM parent_pins WHERE email=?').get('a@example.test').salt,stored.salt);
assert.equal((await call({action:'login_pin',email:'a@example.test',pin:'012345'})).status,403);assert.equal((await call({action:'login_pin',email:'a@example.test',pin:'987654'})).status,200);
await call({action:'login_pin',email:'a@example.test',pin:'999999'});assert.equal((await call({action:'login_pin',email:'a@example.test',pin:'987654'})).status,429);
now+=900001;assert.equal((await call({action:'login_pin',email:'a@example.test',pin:'987654'})).status,200);
// Existing email-code clients remain compatible, and legacy users can set a PIN after verification.
const legacyChallenge=await challenge('legacy@example.test'),legacy=await call(legacyChallenge);assert.equal(legacy.status,200);assert.equal((await call({action:'login_pin',email:'legacy@example.test',pin:'123456'})).status,403);
assert.equal((await call({...await challenge('legacy@example.test'),pin:'123456'})).status,200);assert.equal((await call({action:'login_pin',email:'legacy@example.test',pin:'123456'})).status,200);
const bad=await challenge('locked@example.test');const wrong=bad.code==='00000000'?'11111111':'00000000';for(let i=0;i<5;i++)assert.equal((await call({...bad,code:wrong,pin:'222222'})).status,403);assert.equal((await call({...bad,pin:'222222'})).status,403);
const expired=await challenge('expired@example.test');now+=600001;assert.equal((await call({...expired,pin:'222222'})).status,403);
await call({action:'logout'},reset.cookie);assert.equal((await call(undefined,reset.cookie)).data.signedIn,false);
Date.now=realNow;
console.log('PASS: verified PIN creation/reset; salted hashing; email+PIN login; cross-device family restoration; account isolation; origin protection; rate limits; code expiry/replay/attempt limits; legacy compatibility; revoked sessions; logout. All email delivery mocked.');

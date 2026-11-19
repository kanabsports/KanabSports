// Node 22+: node tests/family-push-activation.test.mjs
// No production device or notification is contacted. Delivery is mocked.
import {createECDH,hkdfSync,createDecipheriv,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/push.js';
import {notifyTeam} from '../functions/_lib/web-push.js';

const sql=new DatabaseSync(':memory:');
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args}
 bind(...args){return new Statement(this.query,args)}
 async first(){return sql.prepare(this.query).get(...this.args)}
 async all(){return {results:sql.prepare(this.query).all(...this.args)}}
 async run(){return sql.prepare(this.query).run(...this.args)}
}
const db={prepare:query=>new Statement(query)};
const endpoint='https://web.push.apple.com/family-test-device';
const token='a'.repeat(64),cookieToken='b'.repeat(64);
const cookie='__Host-ks_parent='+cookieToken;
async function call(body,cookieValue=''){
 const response=await onRequest({env:{SPORTS_DB:db},request:new Request('https://kanabsports.com/api/push',{
  method:body?'POST':'GET',headers:{Origin:'https://kanabsports.com','Content-Type':'application/json',Cookie:cookieValue,'CF-Connecting-IP':'192.0.2.7'},
  body:body?JSON.stringify(body):undefined
 })});
 return {status:response.status,data:await response.json()};
}
assert((await call()).data.publicKey,'Push public key is available to the app');
sql.prepare('INSERT INTO parent_sessions(hash,email,expires) VALUES(?,?,?)').run(
 Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cookieToken))).toString('hex'),
 'howdy@kanabsports.com',Date.now()+3600_000
);
const subscribe=(codes,tk=token)=>({action:'subscribe',codes,endpoint,token:tk});
// An unauthenticated user cannot register a device with no accessible teams.
assert.equal((await call(subscribe([]))).status,403);
assert.equal((await call(subscribe(['PRIVATE-NOT-APPROVED']))).status,403);
// A signed-in parent can enable/test the phone while school access is pending.
let response=await call(subscribe(['PRIVATE-NOT-APPROVED']),cookie);
assert.equal(response.status,200);assert.equal(response.data.registeredTeams,0);
assert.equal(response.data.awaitingApproval,1);
let device=sql.prepare('SELECT parent_email,codes FROM push_devices').get();
assert.equal(device.parent_email,'howdy@kanabsports.com');
assert.deepEqual(JSON.parse(device.codes),[],'Unapproved codes must never be stored');
assert.equal((await notifyTeam(db,'PRIVATE-NOT-APPROVED','private-1')).accepted,0);
// The app can reconcile an empty team list without disabling an approved device.
response=await call(subscribe([]),cookie);
assert.equal(response.status,200);assert.equal(response.data.registeredTeams,0);
// A mixture keeps allowed public teams and excludes unapproved school teams.
response=await call(subscribe(['KANAB-HS','PRIVATE-NOT-APPROVED']),cookie);
assert.equal(response.status,200);assert.equal(response.data.registeredTeams,1);
assert.equal(response.data.awaitingApproval,1);
assert.deepEqual(JSON.parse(sql.prepare('SELECT codes FROM push_devices').get().codes),['KANAB-HS']);
assert.equal((await call(subscribe(['KANAB-HS'],'c'.repeat(64)),cookie)).status,403,'Device token ownership stays enforced');
const handset=createECDH('prime256v1');
const publicKey=handset.generateKeys(),auth=randomBytes(16);
const deviceKeys={p256dh:publicKey.toString('base64url'),auth:auth.toString('base64url')};
let attempts=0;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,endpoint);assert.equal(options.redirect,'manual');
 if(!attempts){
  assert.equal(options.headers['Content-Encoding'],'aes128gcm');
  const frame=Buffer.from(options.body),sender=frame.subarray(21,86);
  assert.equal(frame.readUInt32BE(16),4096);
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),publicKey,sender]);
  const ikm=hkdfSync('sha256',handset.computeSecret(sender),auth,info,32);
  const derive=(label,n)=>hkdfSync('sha256',ikm,frame.subarray(0,16),'Content-Encoding: '+label+'\0',n);
  const cipher=createDecipheriv('aes-128-gcm',derive('aes128gcm',16),derive('nonce',12));
  cipher.setAuthTag(frame.subarray(-16));
  assert.equal(Buffer.concat([cipher.update(frame.subarray(86,-16)),cipher.final()]).toString(),'family-device-test\x02');
 }
 attempts++;
 return new Response(null,{status:201});
};
assert.equal((await call({action:'test',endpoint,keys:deviceKeys,token:'e'.repeat(64)},cookie)).status,403);
response=await call({action:'test',endpoint,token,keys:deviceKeys},cookie);
assert.equal(response.status,200);assert.equal(response.data.status,'accepted');
assert.equal(attempts,1,'A real push transport attempt is made on request');
assert.equal((await notifyTeam(db,'PRIVATE-NOT-APPROVED','private-2')).accepted,0);
assert.equal((await notifyTeam(db,'KANAB-HS','public-1')).accepted,1);
assert.equal(attempts,2);
response=await call({action:'unsubscribe',endpoint,token},cookie);
assert.equal(response.status,200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n,0);
console.log('PASS: signed-in push setup, pending guardian approval separation, test dispatch, access filtering, account/endpoint ownership, and unsubscribe.');

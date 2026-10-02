import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/push.js';
import {notifyTeam,validEndpoint} from '../functions/_lib/web-push.js';
const sql=new DatabaseSync(':memory:');
class Statement{constructor(query,args=[]){this.query=query;this.args=args;}bind(...args){return new Statement(this.query,args);}async first(){return sql.prepare(this.query).get(...this.args);}async all(){return {results:sql.prepare(this.query).all(...this.args)};}async run(){return sql.prepare(this.query).run(...this.args);}}
const db={prepare:q=>new Statement(q)},env={SPORTS_DB:db};
const endpoint='https://web.push.apple.com/test-device-only',token='a'.repeat(64);
async function call(body,origin='https://kanabsports.com'){return onRequest({env,request:new Request('https://kanabsports.com/api/push',{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})});}
assert(!validEndpoint('https://127.0.0.1/secret'));assert(!validEndpoint('https://web.push.apple.com.evil.test/a'));assert(!validEndpoint('https://web.push.apple.com:444/a'));assert(!validEndpoint('http://web.push.apple.com/a'));
const config=await (await call()).json();assert(config.publicKey);assert(!config.privateKey);assert.deepEqual(config.supportedCodes,['TEAM-D']);assert.equal((await (await call()).json()).publicKey,config.publicKey);
const body={action:'subscribe',endpoint,token,codes:['TEAM-D']};assert.equal((await call(body,'https://evil.test')).status,403);assert.equal((await call({...body,codes:['KANAB-HS']})).status,400);assert.equal((await call(body)).status,200);assert.equal((await call({...body,token:'b'.repeat(64)})).status,403);
let calls=0,status=201;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,endpoint);assert.equal(options.redirect,'error');assert(!options.body);assert.equal(options.headers.TTL,'3600');const m=options.headers.Authorization.match(/^vapid t=(.*), k=(.*)$/);assert(m);const [head,payload,signature]=m[1].split('.');const data=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(data.aud,'https://web.push.apple.com');assert(data.exp>Date.now()/1000);const key=await crypto.subtle.importKey('raw',Buffer.from(m[2],'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(signature,'base64url'),new TextEncoder().encode(head+'.'+payload)));return new Response('',{status});};
await notifyTeam(db,'KANAB-HS','no-target');assert.equal(calls,0);
await notifyTeam(db,'TEAM-D','announcement-1');assert.equal(calls,1);await notifyTeam(db,'TEAM-D','announcement-1');assert.equal(calls,1);
assert.equal((await (await call({action:'test',endpoint,token})).json()).status,'accepted');
status=410;await notifyTeam(db,'TEAM-D','announcement-2');assert.equal(sql.prepare('SELECT count(*) n FROM push_devices').get().n,0);
assert.equal((await call(body)).status,200);assert.equal((await call({action:'unsubscribe',endpoint,token})).status,200);assert.equal(sql.prepare('SELECT count(*) n FROM push_devices').get().n,0);
console.log('PASS private key isolation, stable VAPID key, endpoint allowlist, CSRF, device ownership, scoped recipients, signed JWT, duplicate prevention, test, expiry, and opt-out. No real pushes sent.');

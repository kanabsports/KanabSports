// Run with Node 22+: node tests/owner-business.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../functions/api/business.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function database(){const sql=new DatabaseSync(':memory:');return {sql,prepare(query){return {args:[],bind(...args){this.args=args;return this},async run(){return sql.prepare(query).run(...this.args)},async first(){return sql.prepare(query).get(...this.args)},async all(){return {results:sql.prepare(query).all(...this.args)}}}}}}
async function session(db){db.sql.exec('CREATE TABLE admin_sessions (id TEXT PRIMARY KEY,email TEXT,token_hash TEXT UNIQUE,expires_at TEXT,created_at TEXT)');const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test-session'))).toString('hex');db.sql.prepare("INSERT INTO admin_sessions VALUES ('test','howdy@kanabsports.com',?,'2099-01-01',CURRENT_TIMESTAMP)").run(hash)}
const db=database();await session(db);
const get=()=>api.onRequestGet({request:new Request('https://example.test/api/business',{headers:{Cookie:'ks_admin=test-session'}}),env:{SPORTS_DB:db}});
assert.equal((await api.onRequestGet({request:new Request('https://example.test/api/business'),env:{SPORTS_DB:db}})).status,401);
let result=await (await get()).json();
assert.equal(Math.round(result.transactions.reduce((n,x)=>n+x.amount,0)*100),29102);
await get();assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM business_transactions WHERE lower(vendor)='invideo'").get().n,1);
db.sql.exec("DELETE FROM business_transactions WHERE id='seed-invideo'; INSERT INTO business_transactions(id,type,date,amount,category,vendor,description) VALUES('manual','expense','2026-10-06',20.21,'Software','@Invideo','Video software')");
await get();assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM business_transactions WHERE amount=20.21").get().n,1);
const req=body=>api.onRequestPost({request:new Request('https://example.test/api/business',{method:'POST',headers:{Cookie:'ks_admin=test-session','Content-Type':'application/json'},body:JSON.stringify(body)}),env:{SPORTS_DB:db}});
assert.equal((await req({action:'add',type:'expense',date:'2026-10-06',amount:'invalid'})).status,400);
assert.equal((await req({action:'add',type:'income',date:'2026-10-06',amount:12.50,vendor:'Test'})).status,200);
assert.equal((await req({action:'add',type:'mileage',date:'2026-10-06',miles:4.2,purpose:'Test'})).status,200);
assert.equal((await (await get()).json()).mileage.length,1);
const score=readFileSync(new URL('../functions/api/score-assistant-submit.js',import.meta.url),'utf8');
const normalize=new Function(score.match(/function normalizeDate\([^\n]+/)[0]+';return normalizeDate')();
assert.equal(normalize('10/6/26','2026'),'2026-10-06');assert.equal(normalize('2026-10-06','2026'),'2026-10-06');
console.log('PASS: authentication guard, $291.02 seed, repeat-load/manual Invideo deduplication, invalid amount rejection, income/mileage persistence, score-date syntax regression.');

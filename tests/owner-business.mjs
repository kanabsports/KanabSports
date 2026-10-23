// Run with Node 22+: node tests/owner-business.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../functions/api/business.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function database(){const sql=new DatabaseSync(':memory:');return {sql,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}},prepare(query){return {args:[],bind(...args){this.args=args;return this},async run(){return sql.prepare(query).run(...this.args)},async first(){return sql.prepare(query).get(...this.args)},async all(){return {results:sql.prepare(query).all(...this.args)}}}}}}
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

// Edits preserve identity and source, update totals, and keep categories reusable.
const original=db.sql.prepare("SELECT * FROM business_transactions WHERE id='seed-godaddy'").get();
const beforeCount=db.sql.prepare('SELECT COUNT(*) AS n FROM business_transactions').get().n;
assert.equal((await req({...original,action:'update',amount:101.25,category:'Event Materials'})).status,200);
let ledger=await (await get()).json();
assert.equal(ledger.transactions.length,beforeCount);
assert.equal(ledger.transactions.find(x=>x.id===original.id).amount,101.25);
assert.equal(ledger.transactions.find(x=>x.id===original.id).source,original.source);
assert.ok(ledger.categories.includes('Event Materials'));
assert.equal((await req({...original,action:'update',category:'Other'})).status,200);
ledger=await (await get()).json();assert.ok(ledger.categories.includes('Event Materials'));
assert.equal((await req({...original,action:'update',amount:-1})).status,400);
assert.equal((await req({...original,action:'update',amount:'Infinity'})).status,400);
assert.equal((await req({...original,action:'update',id:'missing'})).status,404);
assert.equal((await req({...original,action:'update',type:'income'})).status,404);
const income=ledger.transactions.find(x=>x.type==='income');
assert.equal((await req({...income,action:'update',amount:27.31,category:'event materials'})).status,200);
assert.equal((await (await get()).json()).categories.filter(x=>x.toLowerCase()==='event materials').length,1);
const mile=ledger.mileage[0];db.sql.prepare('UPDATE business_mileage SET notes=? WHERE id=?').run('Keep note',mile.id);
assert.equal((await req({...mile,action:'update',type:'mileage',miles:9.1})).status,200);
assert.equal(db.sql.prepare('SELECT miles,notes FROM business_mileage WHERE id=?').get(mile.id).notes,'Keep note');
assert.equal((await (await get()).json()).mileage[0].miles,9.1);
const sponsor=await (await req({action:'add',type:'sponsor',vendor:'Test sponsor',amount:100,notes:'Preserve me',frequency:'Monthly',status:'Paid'})).json();
assert.equal((await req({action:'update',id:sponsor.id,type:'sponsor',vendor:'Test sponsor',amount:125,frequency:'Monthly',status:'Paid'})).status,200);
const savedSponsor=(await (await get()).json()).sponsors.find(x=>x.id===sponsor.id);
assert.equal(savedSponsor.amount,125);assert.equal(savedSponsor.notes,'Preserve me');
const manual=db.sql.prepare("SELECT * FROM business_transactions WHERE id='manual'").get();
assert.equal((await req({...manual,action:'update',amount:25})).status,200);
await get();assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM business_transactions WHERE lower(vendor) LIKE '%invideo%'").get().n,1);
assert.equal((await api.onRequestPost({request:new Request('https://example.test/api/business',{method:'POST',body:JSON.stringify({...original,action:'update',amount:1})}),env:{SPORTS_DB:db}})).status,401);
console.log('PASS: amount edits, stable IDs, persistent categories, invalid/missing entries, sponsor/mileage note preservation, edited seed deduplication, unauthorized edits.');

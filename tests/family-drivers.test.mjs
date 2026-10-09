import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/family-drivers.js';
import {sha256} from '../functions/_lib/coach-auth.js';
import {accessSchema} from '../functions/_lib/parent-access.js';
import {CONNECTIONS} from '../assets/family-connections.js';
const sqlite=new DatabaseSync(':memory:');const db={prepare(q){const st=sqlite.prepare(q);let args=[];return{bind(...a){args=a;return this},async run(){return st.run(...args)},async first(){return st.get(...args)||null},async all(){return{results:st.all(...args)}}}}};
await accessSchema(db);sqlite.exec('CREATE TABLE parent_family(email TEXT,entry_id TEXT,team_code TEXT)');
const token='a'.repeat(64);sqlite.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(await sha256(token),'parent@example.test',Date.now()+3600000);sqlite.prepare('INSERT INTO parent_family VALUES(?,?,?)').run('parent@example.test','entry','KANAB-HS');
const env={SPORTS_DB:db,RESEND_API_KEY:'mock'},event=CONNECTIONS['KANAB-HS'].events[0];
async function call(body,auth=true,origin='https://example.test'){return onRequest({env,request:new Request('https://example.test/api/family-drivers',{method:body?'POST':'GET',headers:{cookie:auth?'__Host-ks_parent='+token:'',origin,'Content-Type':'application/json'},body:body?JSON.stringify({team_code:'KANAB-HS',event_id:event.id,...body}):undefined})})}
const original=globalThis.fetch;let sent=[];
globalThis.fetch=async(url,options)=>{sent.push({url,payload:options.body?JSON.parse(options.body):null});return Response.json({id:'mock'})};
try{
 assert.equal((await call(null,false)).status,401);assert.equal((await call({action:'save'},true,'https://other.test')).status,403);
 assert.equal((await call({action:'save',team_code:'OTHER'})).status,403);
 assert.equal((await call({action:'save',driver_name:'Driver',driver_email:'invalid'})).status,400);
 assert.equal((await call({action:'save',driver_name:'Driver',driver_email:'driver@example.test'})).status,200);assert.equal(sent.length,0);
 assert.equal((await (await call()).json()).plans[0].driver_name,'Driver');
 let r=await call({action:'remind'});assert.equal(r.status,200,await r.clone().text());assert.equal(sent[0].payload.to[0],'driver@example.test');assert.equal(sent[0].payload.reply_to,'parent@example.test');assert.equal((await call({action:'remind'})).status,409);
 await call({action:'save',driver_name:'Driver',driver_email:'driver@example.test'});
 const at=new Date(Date.now()+3600000).toISOString();assert.equal((await call({action:'remind',remind_at:at})).status,200);assert.equal(sent.at(-1).payload.scheduled_at,at);
 assert.equal((await call({action:'save',driver_name:'New Driver',driver_email:'new@example.test'})).status,409);
 assert.equal((await call({action:'cancel'})).status,200);assert.ok(sent.at(-1).url.endsWith('/cancel'));
 globalThis.fetch=async()=>Response.json({name:'validation_error'},{status:403});assert.equal((await call({action:'remind'})).status,502);assert.equal((await (await call()).json()).plans[0].status,'failed');
 assert.equal((await call({action:'remind',remind_at:new Date(Date.now()+31*86400000).toISOString()})).status,400);
 console.log('PASS: owner-scoped saved drivers, sign-in/origin/team guards, email validation, no send on save, recipient selection, provider receipts, duplicate send gate, scheduling, cancellation, failure status and time limits. All emails mocked.');
}finally{globalThis.fetch=original;sqlite.close()}

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ensureCoachCore,sha256} from '../functions/_lib/coach-auth.js';
import {accessSchema} from '../functions/_lib/parent-access.js';
import {schoolSchema} from '../functions/_lib/school-access.js';
import {schema as privateSchema} from '../functions/_lib/private-messages.js';
import {teamMessagesSchema} from '../functions/_lib/family-unread.js';
import {onRequestGet as unreadEndpoint} from '../functions/api/family-unread.js';
import {onRequestPost as acknowledgeUpdate} from '../functions/api/family-message-receipts.js';
import {onRequest as privateMessages} from '../functions/api/private-messages.js';

const sqlite=new DatabaseSync(':memory:');
class Statement{constructor(sql,args=[]){this.sql=sql;this.statement=sqlite.prepare(sql);this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return this.statement.get(...this.args)||null}async all(){return {results:this.statement.all(...this.args)}}async run(){const result=this.statement.run(...this.args);return {...result,meta:{changes:result.changes}}}}
const db={prepare:sql=>new Statement(sql),async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
await ensureCoachCore(db);await accessSchema(db);await schoolSchema(db);await privateSchema(db);await teamMessagesSchema(db);
sqlite.exec('CREATE TABLE parent_accounts(email TEXT PRIMARY KEY,name TEXT,created INTEGER,last_seen INTEGER)');
const email='badge-parent@example.test',token='7'.repeat(64),now=Date.now(),env={SPORTS_DB:db,PRIVATE_MESSAGING_ENABLED:'true'};
sqlite.prepare('INSERT INTO parent_accounts VALUES(?,?,?,?)').run(email,'Badge Parent',now,now);
sqlite.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(await sha256(token),email,now+86400000);
sqlite.prepare("INSERT INTO school_teams(team_code,kind,school_id,evidence,assigned_by) VALUES('BADGE-TEAM','travel',NULL,'Fictional badge test','test')").run();
sqlite.prepare("INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status,team_code) VALUES('badge-coach','Badge Coach','coach@example.test','badge-org','Basketball','Head Coach','approved','BADGE-TEAM')").run();
for(const id of ['membership-one','membership-two'])sqlite.prepare('INSERT INTO guardian_memberships VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,email,'BADGE-TEAM',id,'Winter',now+86400000,'approved','test','Fictional badge test',now);
sqlite.prepare("INSERT INTO private_message_teams VALUES('BADGE-TEAM','badge-org','Badge Team',1)").run();
sqlite.prepare("INSERT INTO private_message_coaches VALUES('BADGE-TEAM','badge-coach',1)").run();
sqlite.prepare("INSERT INTO coach_team_messages(id,coach_id,team_code,author,body,created_at,category) VALUES('general-update','badge-coach','BADGE-TEAM','Badge Coach','General update',datetime('now'),'general'),('schedule-update','badge-coach','BADGE-TEAM','Badge Coach','Schedule update',datetime('now'),'schedule')").run();
sqlite.prepare("INSERT INTO private_conversations VALUES('badge-thread','badge-org','BADGE-TEAM',?,'badge-coach',?)").run(email,now);
sqlite.prepare("INSERT INTO private_messages(id,conversation_id,sender_role,sender_id,sender_name,body,created,category,subject) VALUES('incoming-message','badge-thread','coach','badge-coach','Badge Coach','Incoming',?,'general','General'),('outgoing-message','badge-thread','parent',?,'Badge Parent','Outgoing',?,'general','General')").run(now,email,now);

const headers={Cookie:'__Host-ks_parent='+token,Origin:'https://kanabsports.com','Content-Type':'application/json'};
async function unread(){const response=await unreadEndpoint({env,request:new Request('https://kanabsports.com/api/family-unread',{headers})});return {status:response.status,data:await response.json()}}
let result=await unread();assert.equal(result.status,200);assert.deepEqual({unread:result.data.unread,updates:result.data.updates,messages:result.data.messages},{unread:3,updates:2,messages:1},'duplicate memberships and an outgoing private message must not double count');
sqlite.prepare("INSERT INTO notification_preferences VALUES('parent',?,'general',0,1)").run(email);
result=await unread();assert.deepEqual({unread:result.data.unread,updates:result.data.updates,messages:result.data.messages},{unread:1,updates:1,messages:0},'muted push categories must not count');
sqlite.prepare("UPDATE notification_preferences SET push_muted=0 WHERE identity=? AND category='general'").run(email);
let response=await acknowledgeUpdate({env,request:new Request('https://kanabsports.com/api/family-message-receipts',{method:'POST',headers,body:JSON.stringify({team_code:'BADGE-TEAM',message_id:'general-update'})})});
assert.equal(response.status,200);assert.equal((await response.json()).unread,2);
response=await privateMessages({env,request:new Request('https://kanabsports.com/api/private-messages?role=parent&conversation=badge-thread',{headers})});
assert.equal(response.status,200);assert.equal((await unread()).data.unread,1,'opening an eligible private thread marks only its incoming messages read');
response=await acknowledgeUpdate({env,request:new Request('https://kanabsports.com/api/family-message-receipts',{method:'POST',headers,body:JSON.stringify({team_code:'BADGE-TEAM',message_id:'schedule-update'})})});
assert.equal(response.status,200);assert.equal((await response.json()).unread,0,'the count clears after the last eligible item is read');
sqlite.prepare("UPDATE guardian_memberships SET status='revoked' WHERE team_code='BADGE-TEAM'").run();
sqlite.prepare("INSERT INTO coach_team_messages(id,coach_id,team_code,author,body,created_at,category) VALUES('revoked-update','badge-coach','BADGE-TEAM','Badge Coach','No longer eligible',datetime('now'),'general')").run();
assert.equal((await unread()).data.unread,0,'revoked team access must remove unread items');

const listeners={},badges=[],clears=[],notifications=[];let serverCount=7;
const context=vm.createContext({fetch:async()=>({ok:true,json:async()=>({unread:serverCount})}),importScripts:()=>{},self:{addEventListener:(name,handler)=>listeners[name]=handler,navigator:{setAppBadge:async count=>badges.push(count),clearAppBadge:async()=>clears.push(true)},registration:{showNotification:async(title,options)=>notifications.push({title,options})},clients:{claim:async()=>{},openWindow:async()=>{}}}});
vm.runInContext(await readFile(new URL('../assets/pep-push-worker.js',import.meta.url),'utf8'),context);
vm.runInContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),context);
async function push(){const tasks=[];listeners.push({data:null,waitUntil:task=>tasks.push(task)});await Promise.all(tasks)}
await push();assert.deepEqual(badges,[7]);assert.equal(notifications[0].options.data.url,'/family/?view=messages');
serverCount=0;await push();assert.equal(clears.length,1,'zero unread clears the installed-app badge');assert.equal(notifications.length,2);

console.log('PASS numeric family badge: eligible update/private-message deduplication, preference filtering, approval revocation, read transitions, zero clear, and preserved tap-to-Updates destination. No push provider contacted.');

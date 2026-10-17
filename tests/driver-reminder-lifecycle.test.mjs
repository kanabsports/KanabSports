import {onRequestGet as driverView} from '../functions/api/driver-event.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {ensureCoachCore,sha256} from '../functions/_lib/coach-auth.js';
import {accessSchema} from '../functions/_lib/parent-access.js';
import {schoolSchema} from '../functions/_lib/school-access.js';
import {schema} from '../functions/_lib/private-messages.js';
import {sharingSchema} from '../functions/_lib/family-sharing.js';
import {scheduleSchema} from '../functions/_lib/team-schedule.js';
import {driverSchema,cancelAffectedDriverReminders} from '../functions/_lib/driver-reminders.js';
import {notifySchedule} from '../functions/_lib/schedule-notifications.js';
import {onRequest as drivers} from '../functions/api/family-drivers.js';
import {onRequest as schedule} from '../functions/api/team-schedule-edit.js';
import {driverReminderMessage} from '../assets/family-drivers.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){const st=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async run(){const r=st.run(...args);return {...r,meta:{changes:r.changes}};},async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};}};}};
 await ensureCoachCore(db);await accessSchema(db);await schoolSchema(db);await schema(db);await sharingSchema(db);await scheduleSchema(db);
 sqlite.exec(`CREATE TABLE parent_family(email TEXT,entry_id TEXT,team_code TEXT);
 CREATE TABLE coach_documents(id TEXT PRIMARY KEY,verification_id TEXT,status TEXT,created_at TEXT,reviewed_at TEXT);
 CREATE TABLE coach_schedule_games(id TEXT,coach_id TEXT,date TEXT,opponent TEXT,time TEXT,site TEXT,source_document_id TEXT);
 CREATE TABLE parent_accounts(email TEXT PRIMARY KEY,name TEXT,created INTEGER,last_seen INTEGER);`);
 const tokens={};
 for(const [i,person,code] of [[1,'alex','REC-FICTION'],[2,'blair','REC-FICTION'],[3,'cameron','TRAVEL-FICTION'],[4,'delegate','REC-FICTION']]){
  tokens[person]=String(i).repeat(64);
  sqlite.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(await sha256(tokens[person]),person+'@example.test',Date.now()+86400000);
  sqlite.prepare('INSERT INTO parent_accounts VALUES(?,?,?,?)').run(person+'@example.test',person+' Fiction',1,1);
  if(person==='delegate')continue;
  sqlite.prepare('INSERT INTO parent_family VALUES(?,?,?)').run(person+'@example.test',person,code);
  sqlite.prepare('INSERT INTO guardian_memberships VALUES(?,?,?,?,?,?,?,?,?,?)').run(person,person+'@example.test',code,'fictional-child-'+i,'Fall',Date.now()+86400000,'approved','test','fictional only',Date.now());
 }
 for(const [coach,code,kind] of [['coach','REC-FICTION','rec'],['otherCoach','TRAVEL-FICTION','travel'],['schoolCoach','SCHOOL-FICTION','school']]){
  tokens[coach]=coach+'-fictional-session';
  sqlite.prepare('INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status,team_code) VALUES(?,?,?,?,?,?,?,?)').run(coach,'Coach Fiction',coach+'@example.test',code,'Soccer','Head Coach','approved',code);
  sqlite.prepare("INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES(?,?,?,?,datetime('now','+1 hour'))").run(coach,coach,coach+'@example.test',await sha256(tokens[coach]));
  sqlite.prepare('INSERT INTO school_teams(team_code,kind,school_id,evidence,assigned_by) VALUES(?,?,?,?,?)').run(code,kind,kind==='school'?'fictional-school':null,'fictional','test');
  sqlite.prepare('INSERT INTO private_message_teams VALUES(?,?,?,1)').run(code,code,'Fictional team');
  sqlite.prepare('INSERT INTO private_message_coaches VALUES(?,?,1)').run(code,coach);
  sqlite.prepare('INSERT INTO coach_documents VALUES(?,?,?,?,?)').run(coach+'-doc',coach,'approved','2026-10-01',null);
  for(const id of ['event','other-event'])sqlite.prepare('INSERT INTO coach_schedule_games VALUES(?,?,?,?,?,?,?)').run(id,coach,'2026-12-15','Fictional Otters','5:00 PM','Fictional Field',coach+'-doc');
 }
 const env={SPORTS_DB:db,PRIVATE_MESSAGING_ENABLED:'true',FAMILY_SHARING_ENABLED:'true',RESEND_API_KEY:'fictional-key'};
 const calls=[],hooks={};let sequence=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  assert.ok(url.startsWith('https://api.resend.com/emails'),'No real provider/device requests allowed');
  const body=options.body?JSON.parse(options.body):null;
  const call={url,options,body};calls.push(call);
  if(url.endsWith('/cancel'))return hooks.cancel?hooks.cancel(call):Response.json({id:url.split('/').at(-2)});
  if(options.method==='POST')return hooks.send?hooks.send(call):Response.json({id:'fictional-email-'+(++sequence)});
  return hooks.get?hooks.get(call):Response.json({id:url.split('/').at(-1),last_event:'scheduled'});
 };
 t.after(()=>{globalThis.fetch=originalFetch;sqlite.close();});
 async function call(fn,person,body,options={}){
  const cookie=person?.includes('Coach')||person==='coach'?'ks_coach='+tokens[person]:person?'__Host-ks_parent='+tokens[person]:'';
  const response=await fn({request:new Request('https://kanabsports.com/api/test',{method:body?'POST':'GET',headers:{cookie,Origin:'https://kanabsports.com','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env:options.env||env,...(options.waitUntil?{waitUntil:options.waitUntil}:{})});
  return {status:response.status,data:await response.json()};
 }
 const driver=(action,extra={},person='alex',options={})=>call(drivers,person,{action,team_code:person==='cameron'?'TRAVEL-FICTION':'REC-FICTION',event_id:'event',...extra},options);
 const defaults={team_code:'REC-FICTION',event_id:'event',date:'2026-12-15',time:'5:00 PM',title:'Game vs Fictional Otters',detail:'Fictional Field · Fictional Otters',cancelled:false,revision:0};
 const edit=(extra={},person='coach',options={})=>call(schedule,person,{...defaults,...extra},options);
 const plan=(person='alex',event='event')=>sqlite.prepare('SELECT * FROM family_driver_plans WHERE owner_email=? AND event_id=?').get(person+'@example.test',event);
 const queued=()=>calls.filter(c=>c.body?.subject?.startsWith('Driver reminder'));
 const cancellations=()=>calls.filter(c=>c.url.endsWith('/cancel'));
 async function queue(person='alex',extra={}){
  let r=await driver('save',{driver_name:'Fictional Driver '+person,driver_email:person+'-driver@example.test',...extra},person);assert.equal(r.status,200,JSON.stringify(r));
  r=await driver('remind',{remind_at:new Date(Date.now()+86400000).toISOString(),...extra},person);assert.equal(r.status,200,JSON.stringify(r));return plan(person,extra.event_id||'event');
 }
 return {db,sqlite,env,calls,hooks,call,driver,edit,plan,queue,queued,cancellations,defaults};
}

test('schedule edits cancel exactly affected families, preserve assignments, require explicit current-revision replacement',async t=>{
 const f=await fixture(t);
 const before=await f.queue();await f.queue('blair');await f.queue('alex',{event_id:'other-event'});await f.queue('cameron');
 const r=await f.edit({time:'6:30 PM',detail:'Fictional North Field'});assert.equal(r.status,200);
 assert.equal(f.cancellations().length,2);assert.equal(f.queued().length,4,'No automatic replacement sends');
 for(const p of ['alex','blair']){assert.equal(f.plan(p).status,'cancelled');assert.equal(f.plan(p).review_required,1);assert.equal(f.plan(p).event_id,'event');}
 assert.equal(f.plan().driver_email,before.driver_email);assert.equal(f.plan().driver_name,before.driver_name);
 assert.equal(f.plan('alex','other-event').status,'scheduled');assert.equal(f.plan('cameron').status,'scheduled');
 assert.match(driverReminderMessage(f.plan()),/Replacement reminder needed/);
 await notifySchedule(f.db,f.env,'REC-FICTION','event',1);assert.equal(f.cancellations().length,2,'Replay is idempotent');
 assert.equal((await f.driver('remind',{event_revision:0})).status,409,'Stale dialog cannot authorize new details');
 const replacement=await f.driver('remind',{event_revision:1,remind_at:new Date(Date.now()+7200000).toISOString()});assert.equal(replacement.status,200,JSON.stringify(replacement));
 assert.equal(f.queued().length,5);const liveUrl=f.queued().at(-1).body.text.match(/https:\/\/[^\s]+/)[0];const view=await driverView({env:f.env,request:new Request(liveUrl)});const html=await view.text();assert.match(html,/6:30 PM/);assert.match(html,/Fictional North Field/);assert(!f.queued().at(-1).body.text.includes('6:30 PM'));
 assert.equal(f.plan().review_required,0);assert.equal(f.plan().status,'scheduled');
 assert.notEqual(f.plan().provider_id,before.provider_id);
 await notifySchedule(f.db,f.env,'REC-FICTION','event',1);assert.equal(f.plan().status,'scheduled','An old notice cannot cancel the replacement');
});

test('no-op saves send nothing; date/location/title edits and cancellation/restoration invalidate reminders',async t=>{
 const f=await fixture(t);await f.queue();
 const noop=await f.edit();assert.equal(noop.data.revision,0);assert.equal(f.cancellations().length,0);
 assert.equal((await f.edit({date:'2026-12-16'})).status,200);assert.equal(f.plan().status,'cancelled');
 await f.driver('remind',{event_revision:1,remind_at:new Date(Date.now()+7200000).toISOString()});
 assert.equal((await f.edit({revision:1,cancelled:true})).status,200);assert.equal(f.plan().event_cancelled,1);assert.equal(f.plan().status,'cancelled');
 assert.equal((await f.driver('remind',{event_revision:2})).status,409);assert.equal((await f.driver('save',{driver_name:'X',driver_email:'x@example.test'})).status,409);
 assert.match(driverReminderMessage(f.plan()),/do not send a replacement/);
 assert.equal((await f.edit({revision:2,title:'Restored practice'})).status,200);assert.equal(f.plan().event_cancelled,0);assert.equal(f.plan().review_required,1);
 assert.equal(f.queued().length,2);
});

for(const mode of ['429','401','500','timeout','malformed','wrong-id','missing-key'])test(`provider cancellation ${mode} remains visible, blocks duplicate sends, and can be retried safely`,async t=>{
 const f=await fixture(t);const p=await f.queue();
 f.hooks.cancel=async()=>{if(mode==='timeout')throw Error('fictional timeout');if(mode==='malformed')return new Response('not-json');if(mode==='wrong-id')return Response.json({id:'different-id'});return Response.json({error:'fictional failure'},{status:Number(mode)||500});};
 if(mode==='missing-key')delete f.env.RESEND_API_KEY;
 const saved=await f.edit({time:'6:00 PM'});assert.equal(saved.status,200,'Provider failures do not undo saved schedule');
 assert.equal(f.plan().status,'cancel_failed');assert.equal(f.plan().review_required,1);assert.equal(f.plan().provider_id,p.provider_id);
 assert.match(f.plan().last_error,/may still arrive/);
 assert.equal((await f.driver('remind',{event_revision:1})).status,409);
 assert.equal((await f.driver('save',{driver_name:'New',driver_email:'new@example.test'})).status,409);
 assert.equal(f.queued().length,1);
 f.env.RESEND_API_KEY='fictional-key';delete f.hooks.cancel;
 assert.equal((await f.driver('cancel')).status,200);assert.equal(f.plan().status,'cancelled');assert.equal(f.plan().review_required,1);
 assert.equal(f.cancellations().at(-1).url,`https://api.resend.com/emails/${p.provider_id}/cancel`);
});

for(const delivery of ['sent','delivered','delivery_delayed','canceled','failed','suppressed','queued'])test(`cancellation rejection reconciles provider state ${delivery} without claiming recall`,async t=>{
 const f=await fixture(t);await f.queue();
 f.hooks.cancel=async()=>Response.json({message:'fictional conflict'},{status:409});
 f.hooks.get=async c=>Response.json({id:c.url.split('/').at(-1),last_event:delivery});
 await f.edit({time:'7:00 PM'});
 const expected=delivery==='canceled'?'cancelled':['failed','suppressed'].includes(delivery)?'failed':delivery==='queued'?'cancel_failed':'stale_sent';
 assert.equal(f.plan().status,expected);assert.equal(f.plan().review_required,1);assert.equal(f.queued().length,1);
 if(expected==='stale_sent')assert.match(driverReminderMessage(f.plan()),/cannot be recalled/);
 if(expected==='cancel_failed')assert.equal((await f.driver('remind',{event_revision:1})).status,409);
});

test('in-flight scheduling receipt is cancelled after a concurrent event edit',async t=>{
 const f=await fixture(t);
 await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 f.hooks.send=async c=>{
  if(c.body.subject.startsWith('Driver reminder')){assert.equal(f.plan().status,'pending');await f.edit({time:'8:00 PM'});assert.equal(f.plan().review_required,1);return Response.json({id:'late-receipt'});}
  return Response.json({id:'generic-notice'});
 };
 const r=await f.driver('remind',{remind_at:new Date(Date.now()+7200000).toISOString()});
 assert.equal(r.status,409);assert.equal(f.plan().status,'cancelled');assert.equal(f.plan().provider_id,'late-receipt');assert.equal(f.plan().review_required,1);
 assert.equal(f.cancellations().length,1);assert.equal(f.queued().length,1);
});

test('immediate reminder already in flight is marked stale and never resent automatically',async t=>{
 const f=await fixture(t);await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 f.hooks.send=async c=>{if(c.body.subject.startsWith('Driver reminder'))await f.edit({cancelled:true});return Response.json({id:'in-flight'});};
 assert.equal((await f.driver('remind')).status,409);assert.equal(f.plan().status,'stale_sent');assert.equal(f.plan().event_cancelled,1);assert.equal(f.cancellations().length,0);assert.equal(f.queued().length,1);
});

test('send timeout without provider ID remains blocked after schedule change',async t=>{
 const f=await fixture(t);await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 f.hooks.send=async c=>{if(c.body.subject.startsWith('Driver reminder')){await f.edit({time:'6:00 PM'});throw Error('fictional send timeout');}return Response.json({id:'generic'});};
 assert.equal((await f.driver('remind',{remind_at:new Date(Date.now()+7200000).toISOString()})).status,409);
 assert.equal(f.plan().status,'send_unconfirmed');assert.equal(f.plan().review_required,1);
 assert.equal((await f.driver('remind',{event_revision:1})).status,409);assert.equal((await f.driver('check_delivery')).status,409);assert.equal(f.queued().length,1);
});

test('same-revision concurrent edits have one winner; later revisions share one cancellation claim',async t=>{
 const f=await fixture(t);await f.queue();
 const entered=deferred(),release=deferred();
 f.hooks.cancel=async c=>{entered.resolve();await release.promise;return Response.json({id:c.url.split('/').at(-2)});};
 const first=f.edit({time:'6:00 PM'});await entered.promise;
 assert.equal(f.plan().status,'cancelling');
 assert.equal((await f.edit({time:'7:00 PM'})).status,409);
 const second=await f.edit({time:'7:00 PM',revision:1});assert.equal(second.status,200);
 assert.equal(f.cancellations().length,1);assert.equal(f.plan().invalidated_revision,2);
 release.resolve();assert.equal((await first).status,200);assert.equal(f.plan().status,'cancelled');assert.equal(f.plan().review_required,1);
 assert.equal(f.plan().invalidated_revision,2);assert.equal(f.queued().length,1);
});

test('schedule invalidation is committed before background cancellation begins and despite muted notices',async t=>{
 const f=await fixture(t);await f.queue();
 f.sqlite.exec("CREATE TABLE IF NOT EXISTS notification_preferences(role TEXT,identity TEXT,category TEXT,email_muted INTEGER,push_muted INTEGER,PRIMARY KEY(role,identity,category)); INSERT OR REPLACE INTO notification_preferences VALUES('parent','alex@example.test','schedule',1,1),('parent','blair@example.test','schedule',1,1)");
 const entered=deferred(),release=deferred(),tasks=[];
 f.hooks.cancel=async c=>{entered.resolve();await release.promise;return Response.json({id:c.url.split('/').at(-2)});};
 const r=await f.edit({time:'9:00 PM'},'coach',{waitUntil:task=>tasks.push(task)});assert.equal(r.status,200);assert.equal(f.plan().review_required,1);
 await entered.promise;assert.equal(f.plan().status,'cancelling');release.resolve();await Promise.all(tasks);
 assert.equal(f.plan().status,'cancelled');assert.equal(f.calls.filter(c=>c.body?.subject==='A team schedule changed in Pep').length,0);
});

test('expired cancellation lease recovers and late completion cannot overwrite a replacement',async t=>{
 const f=await fixture(t);await f.queue();
 const entered=deferred(),release=deferred();let first=true;
 f.hooks.cancel=async c=>{if(first){first=false;entered.resolve();await release.promise;}return Response.json({id:c.url.split('/').at(-2)});};
 const edit=f.edit({time:'6:00 PM'});await entered.promise;
 f.sqlite.exec('UPDATE family_driver_plans SET cancel_started=0');
 assert.equal((await f.driver('cancel')).status,200);
 assert.equal((await f.driver('remind',{event_revision:1,remind_at:new Date(Date.now()+7200000).toISOString()})).status,200);
 const replacement=f.plan();release.resolve();await edit;
 assert.equal(f.plan().status,'scheduled');assert.equal(f.plan().provider_id,replacement.provider_id);assert.equal(f.plan().review_required,0);assert.equal(f.plan().attempt,2);
});

test('late delivery check cannot overwrite newer cancellation or a replacement attempt',async t=>{
 const f=await fixture(t);await f.queue();const entered=deferred(),release=deferred();
 f.hooks.get=async c=>{entered.resolve();await release.promise;return Response.json({id:c.url.split('/').at(-1),last_event:'sent'});};
 const checking=f.driver('check_delivery');await entered.promise;
 await f.edit({detail:'New Fictional Field'});
 assert.equal((await f.driver('remind',{event_revision:1,remind_at:new Date(Date.now()+7200000).toISOString()})).status,200);
 const replacement=f.plan();release.resolve();await checking;
 assert.equal(f.plan().status,'scheduled');assert.equal(f.plan().provider_id,replacement.provider_id);assert.equal(f.plan().review_required,0);
});

test('coach/admin sessions and view-only delegates cannot read or authorize driver replacements; school and flag gates hold',async t=>{
 const f=await fixture(t);await f.queue();
 for(const person of ['coach','otherCoach','schoolCoach',null]){
  assert.equal((await f.call(drivers,person)).status,401);assert.equal((await f.driver('cancel',{},person)).status,401);
 }
 const response=await drivers({env:f.env,request:new Request('https://kanabsports.com/api/family-drivers',{headers:{Cookie:'ks_admin=fictional; ks_score=fictional'}})});assert.equal(response.status,401);
 f.sqlite.prepare('INSERT INTO family_delegates VALUES(?,?,?,?,?,?,?,?)').run('grant','alex@example.test','delegate@example.test','["REC-FICTION"]',0,1,'active',1);
 assert.equal((await f.driver('cancel',{owner_email:'alex@example.test'},'delegate')).status,403);
 await f.edit({time:'6:00 PM'});
 assert.equal((await f.driver('remind',{owner_email:'alex@example.test',event_revision:1},'delegate')).status,403);
 const shared=await f.call(drivers,'delegate');assert.equal(shared.data.plans[0].review_required,1);assert.equal(shared.data.plans[0].can_edit,false);
 assert.equal((await f.edit({team_code:'SCHOOL-FICTION'},'schoolCoach')).status,403);
 assert.equal((await f.edit({},'coach',{env:{...f.env,PRIVATE_MESSAGING_ENABLED:'false'}})).status,503);
 const before=f.calls.length;await cancelAffectedDriverReminders(f.db,{...f.env,PRIVATE_MESSAGING_ENABLED:'false'},'REC-FICTION','event');await cancelAffectedDriverReminders(f.db,f.env,'SCHOOL-FICTION','event');assert.equal(f.calls.length,before);
 for(const kind of ['school','unknown']){f.sqlite.prepare('UPDATE school_teams SET kind=? WHERE team_code=?').run(kind,'REC-FICTION');assert.equal((await f.edit({revision:1})).status,403);}
});

test('additive schema migration retains legacy scheduled receipt and assignment',async t=>{
 const f=await fixture(t);
 f.sqlite.exec('DROP TRIGGER driver_schedule_insert; DROP TRIGGER driver_schedule_update; DROP TABLE family_driver_plans; CREATE TABLE family_driver_plans(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,team_code TEXT NOT NULL,event_id TEXT NOT NULL,driver_name TEXT NOT NULL,driver_email TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,remind_at TEXT,last_error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)');
 f.sqlite.prepare('INSERT INTO family_driver_plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(await sha256('alex@example.test|REC-FICTION|event'),'alex@example.test','REC-FICTION','event','Fictional legacy driver','legacy@example.test','scheduled','legacy-receipt',new Date(Date.now()+86400000).toISOString(),null,1,new Date().toISOString());
 await Promise.all([driverSchema(f.db),driverSchema(f.db)]);await scheduleSchema(f.db);
 await f.edit({time:'6:00 PM'});assert.equal(f.plan().status,'cancelled');assert.equal(f.plan().provider_id,'legacy-receipt');assert.equal(f.plan().driver_name,'Fictional legacy driver');
});

for(const mode of ['malformed-success','server-error'])test(`ambiguous send ${mode} cannot create duplicate reminder attempts`,async t=>{
 const f=await fixture(t);await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 f.hooks.send=async()=>mode==='malformed-success'?Response.json({}):Response.json({error:'fictional error'},{status:500});
 assert.equal((await f.driver('remind',{remind_at:new Date(Date.now()+7200000).toISOString()})).status,502);
 assert.equal(f.plan().status,'send_unconfirmed');
 assert.equal((await f.driver('remind')).status,409);assert.equal(f.queued().length,1);
});

test('schedule change between event read and send claim prevents stale dispatch',async t=>{
 const f=await fixture(t);await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 const prepare=f.db.prepare;let changed=false;
 f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(sql.includes("SET status='pending',attempt=attempt+1")){const first=statement.first;statement.first=async function(){if(!changed){changed=true;await f.edit({time:'8:30 PM'});}return first.call(this);};}return statement;};
 assert.equal((await f.driver('remind')).status,409);assert.equal(f.queued().length,0);
});

test('revocation or schedule change after send claim suppresses provider dispatch',async t=>{
 const f=await fixture(t);await f.driver('save',{driver_name:'Fictional Driver',driver_email:'driver@example.test'});
 f.sqlite.prepare('INSERT INTO family_delegates VALUES(?,?,?,?,?,?,?,?)').run('grant','alex@example.test','delegate@example.test','["REC-FICTION"]',1,1,'active',1);
 const prepare=f.db.prepare;let revoke=true;
 f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(sql.startsWith('SELECT category,email_muted')){const all=statement.all;statement.all=async function(){if(revoke){revoke=false;f.sqlite.exec("UPDATE family_delegates SET can_edit=0");}else await f.edit({time:'9:30 PM'});return all.call(this);};}return statement;};
 assert.equal((await f.driver('remind',{owner_email:'alex@example.test'},'delegate')).status,409);assert.equal(f.queued().length,0);
 // Only intercept preferences for the driver, not the generic schedule notices.
 f.db.prepare=prepare;
 let edited=false;
 f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(sql.startsWith('SELECT category,email_muted')){const all=statement.all;statement.all=async function(){if(!edited){edited=true;await f.edit({time:'9:30 PM'});}return all.call(this);};}return statement;};
 assert.equal((await f.driver('remind')).status,409);assert.equal(f.queued().length,0);assert.equal(f.plan().review_required,1);
});

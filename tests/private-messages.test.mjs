import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureCoachCore,sha256} from '../functions/_lib/coach-auth.js';
import {accessSchema} from '../functions/_lib/parent-access.js';
import {schoolSchema} from '../functions/_lib/school-access.js';
import {schema,deliver,messagingOrigin} from '../functions/_lib/private-messages.js';
import {pushSchema,digest} from '../functions/_lib/web-push.js';
import {onRequest as endpoint} from '../functions/api/private-messages.js';
import {onRequest as pushEndpoint} from '../functions/api/private-message-push.js';
const sqlite=new DatabaseSync(':memory:');
const db={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async run(){const r=statement.run(...args);return {...r,meta:{changes:r.changes}};},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
await ensureCoachCore(db);await accessSchema(db);await schoolSchema(db);await schema(db);await pushSchema(db);
sqlite.exec('CREATE TABLE parent_accounts(email TEXT PRIMARY KEY,name TEXT,created INTEGER,last_seen INTEGER)');
const tokens={},now=Date.now();
for(const [id,name,team,status] of [['coachA','Casey Fiction','REC-A','approved'],['assistantA','Avery Fiction','REC-A','approved'],['coachB','Morgan Fiction','TRAVEL-B','approved'],['coachC','Taylor Fiction','REC-C','approved'],['schoolCoach','School Fiction','SCHOOL','approved'],['pending','Pending Fiction','REC-A','pending']]){
 sqlite.prepare('INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status,team_code) VALUES(?,?,?,?,?,?,?,?)').run(id,name,id+'@example.test',team==='TRAVEL-B'?'org-b':'org-a','Swimming','Coach',status,team);
 tokens[id]=id+'-session';sqlite.prepare("INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES(?,?,?,?,datetime('now','+1 hour'))").run(id,id,id+'@example.test',await sha256(tokens[id]));
}
for(const [i,id,team] of [[1,'parentA','REC-A'],[2,'parentB','TRAVEL-B'],[3,'otherA','REC-A'],[4,'schoolParent','SCHOOL']]){
 tokens[id]=String(i).repeat(64);sqlite.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(await sha256(tokens[id]),id+'@example.test',now+86400000);
 sqlite.prepare('INSERT INTO parent_accounts VALUES(?,?,?,?)').run(id+'@example.test',id+' Fiction',now,now);
 sqlite.prepare('INSERT INTO guardian_memberships VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id+'@example.test',team,'fictional-child-'+i,'Fall',now+86400000,'approved','test','fictional test only',now);
}
for(const [team,kind,org] of [['REC-A','rec','org-a'],['TRAVEL-B','travel','org-b'],['REC-C','rec','org-a'],['SCHOOL','school','school-org']]){
 sqlite.prepare('INSERT INTO school_teams(team_code,kind,school_id,evidence,assigned_by) VALUES(?,?,?,?,?)').run(team,kind,kind==='school'?'school-org':null,'Fictional test','test');
 sqlite.prepare('INSERT INTO private_message_teams VALUES(?,?,?,1)').run(team,org,team+' fictional team');
}
for(const [team,coach] of [['REC-A','coachA'],['REC-A','assistantA'],['REC-A','pending'],['TRAVEL-B','coachB'],['REC-C','coachC'],['SCHOOL','schoolCoach']])sqlite.prepare('INSERT INTO private_message_coaches VALUES(?,?,1)').run(team,coach);
assert.equal(messagingOrigin({}),'https://kanabsports.com');
assert.equal(messagingOrigin({PRIVATE_MESSAGING_BASE_URL:'https://fictional-preview.pages.dev'}),'https://fictional-preview.pages.dev');
for(const url of ['https://evil.example','http://kanabsports.com','https://kanabsports.com/path','https://user:pass@kanabsports.com'])assert.throws(()=>messagingOrigin({PRIVATE_MESSAGING_BASE_URL:url}));
const env={SPORTS_DB:db,PRIVATE_MESSAGING_ENABLED:'true',RESEND_API_KEY:'fictional-test-key'};
const cookie=id=>id&&tokens[id]?(id.startsWith('parent')||id==='otherA'||id==='schoolParent'?'__Host-ks_parent=':'ks_coach=')+tokens[id]:'';
async function call(id,role,body,query='',options={}){
 const r=await (options.push?pushEndpoint:endpoint)({request:new Request('https://kanabsports.com/api/private-messages?role='+role+query,{method:body?'POST':'GET',headers:{cookie:cookie(id),Origin:options.origin??'https://kanabsports.com','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env:options.env||env});
 return {status:r.status,data:await r.json()};
}
let emailMode='ok',pushMode='ok',mail=[],pushCalls=[];
globalThis.fetch=async(url,options)=>{
 if(url==='https://api.resend.com/emails'){mail.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});if(emailMode==='throw')throw Error('fake outage');return Response.json(emailMode==='ok'?{id:'fake-email-id'}:{name:'rate_limit_exceeded'},{status:emailMode==='ok'?200:429});}
 assert.ok(String(url).startsWith('https://fcm.googleapis.com/fictional-'));pushCalls.push(url);return new Response(null,{status:pushMode==='ok'?201:410});
};
assert.equal((await call(null,'parent')).status,401);
assert.equal((await call('pending','coach')).status,401);
assert.equal((await call('parentA','parent',null,'',{env:{SPORTS_DB:db}})).status,503);
assert.equal((await call('parentA','parent',{action:'start' },'',{origin:'https://evil.example'})).status,403);
let list=await call('parentA','parent');assert.deepEqual(list.data.choices.map(c=>c.coach_id).sort(),['assistantA','coachA']);
assert.equal((await call('schoolParent','parent')).data.choices.length,0);
const start=(team,coach,org)=>({action:'start',team_code:team,coach_id:coach,organization_id:org});
assert.equal((await call('parentA','parent',start('TRAVEL-B','coachB','org-b'))).status,403);
assert.equal((await call('parentA','parent',start('REC-C','coachC','org-a'))).status,403);
assert.equal((await call('parentA','parent',start('REC-A','coachA','org-b'))).status,403);
assert.equal((await call('schoolParent','parent',start('SCHOOL','schoolCoach','school-org'))).status,403);
const c=(await call('parentA','parent',start('REC-A','coachA','org-a'))).data.id;assert.ok(c);
assert.equal((await call('parentA','parent',start('REC-A','coachA','org-a'))).data.id,c);
const other=(await call('otherA','parent',start('REC-A','coachA','org-a'))).data.id;
const travel=(await call('parentB','parent',start('TRAVEL-B','coachB','org-b'))).data.id;assert.ok(travel);
for(const [id,role] of [['otherA','parent'],['parentB','parent'],['coachB','coach'],['assistantA','coach'],['schoolCoach','coach']])assert.equal((await call(id,role,null,'&conversation='+c)).status,404);
assert.equal((await call('coachA','coach',null,'&conversation='+travel)).status,404);
const pushBody={action:'subscribe',endpoint:'https://fcm.googleapis.com/fictional-coach',token:'b'.repeat(64)};
assert.equal((await call('coachA','coach',pushBody,'',{push:true})).status,200);
assert.equal((await call('coachB','coach',pushBody,'',{push:true})).status,409);
assert.equal((await call('parentA','parent',{...pushBody,endpoint:'https://fcm.googleapis.com/fictional-parent'},'',{push:true})).status,200);
assert.equal((await call('coachA','coach',{...pushBody,endpoint:'http://127.0.0.1/'},'',{push:true})).status,400);
assert.equal((await call('coachA','coach',{...pushBody,action:'test'},'',{push:true})).data.status,'accepted');pushCalls=[];
const send={action:'send',conversation:c,message_id:crypto.randomUUID(),message:'Fictional parent question <script>unsafe()</script>',sender_name:'Forged',sender_id:'coachB'};
let sent=await call('parentA','parent',send);assert.equal(sent.status,200);assert.equal(sent.data.saved,true);
assert.equal(mail.length,1);assert.equal(mail[0].body.to[0],'coachA@example.test');assert.ok(mail[0].body.text.includes('conversation='+c));assert.ok(!mail[0].body.text.includes('Fictional parent question'));assert.equal(pushCalls.length,1);assert.ok(pushCalls[0].endsWith('fictional-coach'));
assert.equal((await call('parentA','parent',send)).status,200);assert.equal(mail.length,1);assert.equal(pushCalls.length,1);
assert.equal((await call('parentA','parent',{...send,message:'changed retry'})).status,409);
let history=(await call('coachA','coach',null,'&conversation='+c)).data.messages;
assert.equal(history.length,1);assert.equal(history[0].sender_name,'parentA Fiction');assert.equal(history[0].sender_role,'parent');assert.equal(history[0].email_status,'accepted');assert.equal(history[0].push_status,'accepted');
assert.equal((await call('otherA','parent',{...send,conversation:other})).status,409);
const reply={action:'send',conversation:c,message_id:crypto.randomUUID(),message:'Fictional coach reply',category:'general',subject:'Practice question'};
assert.equal((await call('coachA','coach',reply)).status,200);assert.equal(mail.at(-1).body.to[0],'parentA@example.test');assert.ok(pushCalls.at(-1).endsWith('fictional-parent'));
assert.equal((await call('parentA','parent',null,'&conversation='+c)).data.messages[1].sender_name,'Casey Fiction');
emailMode='reject';pushMode='gone';
assert.equal((await call('parentA','parent',{...send,message_id:crypto.randomUUID()})).status,200);
history=(await call('parentA','parent',null,'&conversation='+c)).data.messages;
assert.equal(history.at(-1).email_status,'rejected');assert.equal(history.at(-1).push_status,'failed');
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM private_push_devices WHERE identity='coachA'").get().n,0);
emailMode='throw';
assert.equal((await call('parentA','parent',{...send,message_id:crypto.randomUUID()})).status,200);
assert.equal((await call('parentA','parent',null,'&conversation='+c)).data.messages.at(-1).email_status,'unconfirmed');
assert.equal((await call('parentA','parent',{...send,message_id:crypto.randomUUID()},'',{env:{SPORTS_DB:db,PRIVATE_MESSAGING_ENABLED:'true'}})).status,200);
assert.equal((await call('parentA','parent',null,'&conversation='+c)).data.messages.at(-1).email_status,'not_configured');
assert.equal((await call('coachA','coach',{...reply,message_id:crypto.randomUUID(),message:'shit'})).status,422);
const beforeMail=mail.length;
for(const sql of ["UPDATE guardian_memberships SET status='revoked' WHERE id='parentA'","UPDATE guardian_memberships SET expires=1 WHERE id='parentA'","UPDATE private_message_coaches SET active=0 WHERE coach_id='coachA'","UPDATE coach_access_requests SET status='revoked' WHERE id='coachA'","UPDATE private_message_teams SET enabled=0 WHERE team_code='REC-A'","UPDATE private_message_teams SET organization_id='changed' WHERE team_code='REC-A'","UPDATE school_teams SET kind='school' WHERE team_code='REC-A'","UPDATE school_teams SET kind='unknown' WHERE team_code='REC-A'","UPDATE school_teams SET school_id='school-org' WHERE team_code='REC-A'"]){
 sqlite.exec('SAVEPOINT permission_test');sqlite.exec(sql);
 assert.equal((await call('parentA','parent',null,'&conversation='+c)).status,404,sql);
 const blocked=await call('parentA','parent',{...send,message_id:crypto.randomUUID()});assert.equal(blocked.status,404,sql);
 assert.equal((await call('parentA','parent')).data.conversations.some(x=>x.id===c),false,sql);
 sqlite.exec('ROLLBACK TO permission_test');sqlite.exec('RELEASE permission_test');
}
assert.equal(mail.length,beforeMail);
// A stored but not-yet-notified message is suppressed if access is revoked.
const suppressed=crypto.randomUUID();sqlite.prepare('INSERT INTO private_messages(id,conversation_id,sender_role,sender_id,sender_name,body,created) VALUES(?,?,?,?,?,?,?)').run(suppressed,c,'parent','parentA@example.test','Fiction','queued',now);
sqlite.prepare('INSERT INTO private_message_notices(message_id,updated) VALUES(?,?)').run(suppressed,now);
sqlite.exec("UPDATE guardian_memberships SET status='revoked' WHERE id='parentA'");await deliver(db,env,suppressed);
assert.equal(sqlite.prepare('SELECT status FROM private_message_notices WHERE message_id=?').get(suppressed).status,'suppressed');assert.equal(mail.length,beforeMail);
sqlite.exec("UPDATE guardian_memberships SET status='approved' WHERE id='parentA'");
// Atomic write-time authorization survives revocation between access read and batch.
sqlite.exec('DELETE FROM private_message_limits');
const originalBatch=db.batch;let raced=false;
db.batch=async statements=>{if(!raced){raced=true;sqlite.exec("UPDATE private_message_coaches SET active=0 WHERE coach_id='coachA'");}return originalBatch(statements);};
assert.equal((await call('parentA','parent',{...send,message_id:crypto.randomUUID()})).status,409);
db.batch=originalBatch;sqlite.exec("UPDATE private_message_coaches SET active=1 WHERE coach_id='coachA'");
assert.equal(mail.length,beforeMail);
// Approved assistants can receive their own conversations, never another coach's.
const assistantConversation=(await call('parentA','parent',start('REC-A','assistantA','org-a'))).data.id;
assert.ok(assistantConversation);
assert.equal((await call('assistantA','coach',null,'&conversation='+assistantConversation)).status,200);
assert.equal((await call('coachA','coach',null,'&conversation='+assistantConversation)).status,404);
for(const cookie of ['ks_admin=fictional-admin','ks_score_assistant=fictional-score']){
 const response=await endpoint({request:new Request('https://kanabsports.com/api/private-messages?role=coach&conversation='+c,{headers:{cookie}}),env});
 assert.equal(response.status,401);
}
// Travel teams support the same working reply path.
emailMode='ok';pushMode='ok';
assert.equal((await call('parentB','parent',{...send,conversation:travel,message_id:crypto.randomUUID()})).status,200);
assert.equal(mail.at(-1).body.to[0],'coachB@example.test');
assert.equal((await call('coachB','coach',{...reply,conversation:travel,message_id:crypto.randomUUID()})).status,200);
assert.equal(mail.at(-1).body.to[0],'parentB@example.test');
// Pagination preserves order and cannot leak another family's history.
for(let i=0;i<60;i++)sqlite.prepare('INSERT INTO private_messages(id,conversation_id,sender_role,sender_id,sender_name,body,created) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),c,'parent','parentA@example.test','Fiction','page-'+i,now+i);
const page=(await call('coachA','coach',null,'&conversation='+c)).data;assert.equal(page.messages.length,50);assert.ok(page.older);const older=(await call('coachA','coach',null,'&conversation='+c+'&before='+page.older)).data;assert.ok(older.messages.every(m=>m.sequence<page.older));assert.ok(page.messages.every((m,i,a)=>!i||m.sequence>a[i-1].sequence));
assert.equal((await call('coachA','coach',null,'&conversation='+c+'&before=abc')).status,400);
assert.equal((await call('coachA','coach',{...reply,message_id:crypto.randomUUID(),message:'x'.repeat(4001)})).status,400);
sqlite.exec("UPDATE parent_sessions SET expires=1 WHERE email='parentA@example.test'");assert.equal((await call('parentA','parent',null,'&conversation='+c)).status,401);
// Test limiter independently from earlier request counts.
sqlite.exec('DELETE FROM private_message_limits');
for(let i=0;i<30;i++)await call('parentB','parent',{action:'unknown'});
assert.equal((await call('parentB','parent',{action:'unknown'})).status,429);
console.log('PASS: fictional parent/coach replies; approved selector; team/org/family/assistant isolation; school and unknown-kind denial; CSRF; expiry/revocation; sender attribution; retry deduplication; pagination; rate limiting; private push binding/test/cleanup; targeted email links; provider failures; deferred delivery suppression. All external delivery mocked.');

export {db,sqlite,env,tokens,call};

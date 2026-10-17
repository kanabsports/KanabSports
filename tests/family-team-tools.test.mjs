// Exercise the next set of features on the same realistic fixture after the
// messaging suite; restore session/membership state explicitly below.
import assert from 'node:assert/strict';
import {db,sqlite,env,tokens} from './private-messages.test.mjs';
import {onRequest as sharing} from '../functions/api/family-sharing.js';
import {onRequest as drivers} from '../functions/api/family-drivers.js';
import {onRequest as prefs} from '../functions/api/notification-preferences.js';
import {onRequest as schedule} from '../functions/api/team-schedule-edit.js';
import {onRequest as stats} from '../functions/api/coach-stats.js';
import {onRequest as directory} from '../functions/api/coach-family-directory.js';
import {onRequest as messages} from '../functions/api/private-messages.js';
import {onRequestGet as connection} from '../functions/api/team-connection.js';
import {sha256} from '../functions/_lib/coach-auth.js';
import {sharingSchema} from '../functions/_lib/family-sharing.js';
const config={...env,FAMILY_SHARING_ENABLED:'true'};let emails=[];
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');emails.push(JSON.parse(options.body));return Response.json({id:'fictional-mail'});};
sqlite.prepare('UPDATE parent_sessions SET expires=?').run(Date.now()+86400000);sqlite.exec('DELETE FROM private_message_limits');
sqlite.exec("UPDATE parent_accounts SET email=lower(email); UPDATE parent_sessions SET email=lower(email); UPDATE guardian_memberships SET email=lower(email); UPDATE private_conversations SET parent_email=lower(parent_email); UPDATE private_push_devices SET identity=lower(identity) WHERE role='parent';");
sqlite.exec(`CREATE TABLE parent_family(email TEXT,entry_id TEXT,team_code TEXT,child_name TEXT,created INTEGER,PRIMARY KEY(email,entry_id));
CREATE TABLE coach_documents(id TEXT PRIMARY KEY,verification_id TEXT,name TEXT,email TEXT,sport TEXT,team TEXT,document_type TEXT,season TEXT,notes TEXT,filename TEXT,byte_size INTEGER,status TEXT,review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT);
CREATE TABLE coach_schedule_games(id TEXT PRIMARY KEY,coach_id TEXT,date TEXT,opponent TEXT,time TEXT,site TEXT,result TEXT,source_document_id TEXT,created_at TEXT);
INSERT INTO coach_documents(id,verification_id,status,created_at) VALUES('doc','coachA','approved','2026-10-09');
INSERT INTO coach_schedule_games VALUES('game','coachA','2026-10-20','Fictional Otters','5:00 PM','Fictional Field',NULL,'doc','2026-10-09');
INSERT INTO parent_family VALUES('parenta@example.test','child','REC-A','Fictional Child',1);
INSERT INTO parent_family VALUES('parenta@example.test','public','KANAB-HS','Public Schedule',1);
UPDATE coach_access_requests SET role='Assistant Coach' WHERE id='assistantA';`);
async function call(fn,id,body,query='',overrides={}){
 const role=id?.startsWith('coach')||id==='assistantA'?'coach':'parent';
 const cookie=id?(role==='coach'?'ks_coach=':'__Host-ks_parent=')+tokens[id]:'';
 const r=await fn({request:new Request('https://kanabsports.com/api/test?role='+role+query,{method:body?'POST':'GET',headers:{cookie,Origin:overrides.origin||'https://kanabsports.com',...(!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env:overrides.env||config});
 return {status:r.status,data:(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text()};
}
const preferences=['general','schedule','logistics','stats','urgent'].map(category=>({category,email_muted:category==='general',push_muted:true}));
assert.equal((await call(prefs,'coachA',{preferences})).status,200);
assert.equal((await call(prefs,'coachA')).data.preferences.find(p=>p.category==='general').email_muted,1);
assert.equal((await call(prefs,'coachB')).data.preferences.find(p=>p.category==='general').email_muted,false);
assert.equal((await call(prefs,'coachA',{preferences},'',{origin:'https://evil.example'})).status,403);
const startResult=(await call(messages,'coachA',{action:'start_parent',audience:'parents',team_code:'REC-A',organization_id:'org-a',parent_email:'parenta@example.test'}));const started=startResult.data.id;assert.ok(started);
assert.equal((await call(messages,'coachA',{action:'start_parent',audience:'parent_student',team_code:'REC-A',organization_id:'org-a',parent_email:'parenta@example.test'})).status,403);
assert.equal((await call(messages,'coachB',{action:'start_parent',audience:'parents',team_code:'REC-A',organization_id:'org-a',parent_email:'parenta@example.test'})).status,403);
assert.equal((await call(messages,'coachA',{action:'send',conversation:started,message_id:crypto.randomUUID(),message:'Missing topic label'})).status,400);
const before=emails.length;
assert.equal((await call(messages,'parentA',{action:'send',conversation:started,message_id:crypto.randomUUID(),message:'Muted test'})).status,200);assert.equal(emails.length,before);
const muted=sqlite.prepare('SELECT email_status,push_status FROM private_message_notices ORDER BY updated DESC LIMIT 1').get();assert.equal(muted.email_status,'muted');assert.equal(muted.push_status,'muted');
assert.equal((await call(directory,'coachA')).data.families.some(x=>x.parent_email==='parenta@example.test'),true);
assert.equal((await call(directory,'coachB')).data.families.some(x=>x.parent_email==='parenta@example.test'),false);
assert.equal((await call(sharing,null)).status,401);
const inviteBody={action:'invite',recipient_email:'parentb@example.test',team_codes:['REC-A'],can_edit:false,is_driver:true,sender_email:'forged@example.test'};
const invited=await call(sharing,'parentA',inviteBody);assert.equal(invited.status,200);assert.ok(emails.at(-1).text.includes('parenta@example.test'));assert.ok(!emails.at(-1).text.includes('forged@example.test'));
const token=emails.at(-1).text.match(/#invite=([a-f0-9]+)/)[1];
assert.equal((await call(sharing,'otherA',{action:'accept',token})).status,403);
assert.equal((await call(sharing,'parentB',{action:'accept',token})).status,200);
assert.equal((await call(sharing,'parentB',{action:'accept',token})).status,403);
let shared=(await call(sharing,'parentB')).data.schedules;assert.equal(shared.length,1);assert.equal(shared[0].can_edit,false);assert.equal(shared[0].is_driver,true);assert.equal(shared[0].events[0].id,'game');
assert.equal((await call(connection,'parentB',null,'&code=REC-A')).status,403,'Delegated schedule access never becomes guardian/team-message access');
const driver={action:'save',owner_email:'parenta@example.test',team_code:'REC-A',event_id:'game',driver_name:'Fictional Driver',driver_email:'parentb@example.test'};
assert.equal((await call(drivers,'parentB',driver)).status,403);
assert.equal((await call(drivers,'parentA',driver)).status,200);
// A coach login never grants access to family driver data, even for their team.
for(const coach of ['coachA','coachB','assistantA']){
 assert.equal((await call(drivers,coach)).status,401);
 assert.equal((await call(drivers,coach,driver)).status,401);
 assert.equal((await call(sharing,coach)).status,401);
}
for(const handler of [directory,schedule]){
 const payload=JSON.stringify((await call(handler,'coachA')).data);
 for(const field of ['driver_name','driver_email','is_driver','family_driver_plans'])assert.equal(payload.includes('"'+field+'"'),false,'Coach response must omit '+field);
}

const grant=(await call(sharing,'parentA')).data.grants[0];
assert.equal((await call(sharing,'parentB',{action:'permissions',id:grant.id,can_edit:true,is_driver:true})).status,403);
assert.equal((await call(sharing,'parentA',{action:'permissions',id:grant.id,can_edit:true,is_driver:true})).status,200);
assert.equal((await call(drivers,'parentB',driver)).status,200);
const prepare=db.prepare;let revokedDuringWrite=false;
db.prepare=function(sql){if(!revokedDuringWrite&&sql.startsWith('INSERT INTO family_driver_plans')){revokedDuringWrite=true;sqlite.prepare('UPDATE family_delegates SET can_edit=0 WHERE id=?').run(grant.id);}return prepare.call(this,sql);};
assert.equal((await call(drivers,'parentB',driver)).status,409,'Driver edit grant is rechecked atomically at write time');
db.prepare=prepare;await call(sharing,'parentA',{action:'permissions',id:grant.id,can_edit:true,is_driver:true});

assert.equal((await call(drivers,'parentB',{...driver,owner_email:'othera@example.test'})).status,403);
assert.equal((await call(sharing,'parentB',{action:'invite',recipient_email:'othera@example.test',team_codes:['REC-A'],can_edit:true,is_driver:true})).status,403,'Delegates cannot reshare another family');
const code=(await call(sharing,'parentA',{action:'rotate_code'})).data.code;assert.ok(code);
assert.equal((await call(sharing,'otherA',{action:'request_code',code})).status,200);assert.equal((await call(sharing,'otherA')).data.schedules.length,0,'Personal code requests do not auto-authorize');
await call(sharing,'parentA',{action:'rotate_code'});assert.equal((await call(sharing,'otherA',{action:'request_code',code})).status,400);
const change={team_code:'REC-A',event_id:'game',date:'2026-10-21',time:'6:00 PM',title:'Updated practice',detail:'Fictional North Field',cancelled:false,revision:0};
assert.equal((await call(schedule,'coachB',change)).status,403);assert.equal((await call(schedule,'assistantA',change)).status,403);
assert.equal((await call(schedule,'coachA',change)).status,200);assert.equal((await call(schedule,'coachA',change)).status,409);
assert.equal((await call(connection,'parentA',null,'&code=REC-A')).data.team.events[0].date,'2026-10-21');assert.equal((await call(sharing,'parentB')).data.schedules[0].events[0].time,'6:00 PM');
assert.equal((await call(sharing,'parentA',{action:'revoke',id:grant.id})).status,200);assert.equal((await call(sharing,'parentB')).data.schedules.length,0);assert.equal((await call(drivers,'parentB',driver)).status,403);
await call(sharing,'parentA',inviteBody);const expired=emails.at(-1).text.match(/#invite=([a-f0-9]+)/)[1];sqlite.prepare("UPDATE family_share_invites SET expires=1 WHERE token_hash=?").run(await sha256(expired));assert.equal((await call(sharing,'parentB',{action:'accept',token:expired})).status,403);
let objects=new Map();const bucket={async put(k,b){objects.set(k,b);},async get(k){return objects.has(k)?{body:objects.get(k)}:null;},async delete(k){objects.delete(k);}};
const form=()=>{const f=new FormData();f.set('team_code','REC-A');f.set('pdf',new File(['%PDF-1.4\nFictional stats\n%%EOF'],'hudl-stats.pdf',{type:'application/pdf'}));return f;};
assert.equal((await call(stats,'coachA',form())).status,503);
const upload=await call(stats,'coachA',form(),'',{env:{...config,SPORTS_FILES:bucket}});assert.equal(upload.status,200);assert.ok(upload.data.saved);
assert.equal((await call(stats,'coachB',null,'&id='+upload.data.id,{env:{...config,SPORTS_FILES:bucket}})).status,404);
assert.equal((await call(stats,'coachA',null,'&id='+upload.data.id,{env:{...config,SPORTS_FILES:bucket}})).status,200);
const fake=form();fake.set('pdf',new File(['not a pdf'],'fake.pdf'));assert.equal((await call(stats,'coachA',fake,'',{env:{...config,SPORTS_FILES:bucket}})).status,415);
sqlite.exec("UPDATE school_teams SET kind='school' WHERE team_code='REC-A'");assert.equal((await call(schedule,'coachA',{...change,revision:1})).status,403);assert.equal((await call(stats,'coachA',form(),'',{env:{...config,SPORTS_FILES:bucket}})).status,403);assert.equal((await call(directory,'coachA')).data.families.length,0);
console.log('PASS: mute matrices; required coach labels; coach parent initiation; blocked student mode; recipient-bound single-use/expiry/rotation invites; sender spoof protection; view-only/driver/edit separation; no resharing or guardian escalation; revocation; schedule conflict/access/refresh; private PDF storage/download/signature checks; school gates. All providers/storage mocked.');

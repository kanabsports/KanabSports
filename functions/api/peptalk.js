import {authorized,sameOrigin,json,limit} from '../_lib/pilot.js';
async function schema(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS peptalk_jobs(id TEXT PRIMARY KEY,author TEXT NOT NULL,author_id TEXT NOT NULL,body TEXT NOT NULL,send_at INTEGER NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS peptalk_deliveries(job_id TEXT NOT NULL,phone TEXT NOT NULL,sid TEXT,status TEXT NOT NULL,error TEXT,PRIMARY KEY(job_id,phone))').run();
}
async function config(env){const rows=(await env.SPORTS_DB.prepare("SELECT key,value FROM team_d_settings WHERE key IN ('twilio_account_sid','twilio_service_sid')").all()).results||[];const values=Object.fromEntries(rows.map(r=>[r.key,r.value]));return {account:env.TWILIO_ACCOUNT_SID||values.twilio_account_sid,service:env.TWILIO_MESSAGING_SERVICE_SID||values.twilio_service_sid,token:env.TWILIO_AUTH_TOKEN};}
async function twilio(env,path,body){
 const c=await config(env);const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.account}/Messages${path}.json`,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(c.account+':'+c.token),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(12000)});
 const d=await r.json();if(!r.ok){const e=new Error('Twilio error '+(d.code||r.status));e.definite=r.status<500;e.code=d.code||r.status;throw e;}return d;
}
async function recipients(db){
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sms_enrollment'").first();if(!exists)return [];
 return ((await db.prepare("SELECT DISTINCT phone FROM sms_enrollment WHERE team='britt-soccer' AND status='consented' AND step='complete' AND match_status='matched'").all()).results||[]).filter(r=>/^\+1\d{10}$/.test(r.phone));
}
async function list(db){const jobs=(await db.prepare('SELECT * FROM peptalk_jobs ORDER BY created DESC LIMIT 30').all()).results||[];for(const j of jobs){j.deliveryCounts=(await db.prepare('SELECT status,count(*) AS count FROM peptalk_deliveries WHERE job_id=? GROUP BY status').bind(j.id).all()).results||[];}return jobs;}
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'PepTalk is temporarily unavailable.'},503);
 const member=await authorized(request,db);if(!member)return json({error:'Approved coach sign-in required.'},403);
 try{
 await schema(db);
 const settings=await config(env),configured=!!(settings.token&&/^AC[a-f0-9]{32}$/i.test(settings.account||'')&&/^MG[a-f0-9]{32}$/i.test(settings.service||''));
 if(request.method==='GET')return json({configured,recipientCount:(await recipients(db)).length,jobs:await list(db)});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!sameOrigin(request))return json({error:'Open your coach portal to use PepTalk.'},403);
 if(!configured)return json({error:'Finish connecting PepTalk: text HELP to the team number once, then refresh this page.'},503);
 const raw=await request.text();if(raw.length>5000)return json({error:'Request too long.'},413);
 let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400);}
 if(!/^[a-f0-9-]{36}$/.test(b.id||''))return json({error:'Invalid message identifier.'},400);
 if(b.action==='schedule'){
 const existing=await db.prepare('SELECT id FROM peptalk_jobs WHERE id=?').bind(b.id).first();if(existing)return json({success:true,existing:true});
 const message=String(b.body||'').trim(),sendAt=Number(b.sendAt),now=Date.now();
 if(!message||message.length>1000)return json({error:'Write a message of 1–1,000 characters.'},400);
 if(!Number.isFinite(sendAt)||sendAt<now+16*60000||sendAt>now+35*86400000)return json({error:'Choose a time at least 16 minutes and no more than 35 days from now.'},400);
 const people=await recipients(db);if(!people.length)return json({error:'No parents have completed text signup and matched the roster yet.'},400);
 if(people.length>25)return json({error:'This pilot supports up to 25 enrolled phone numbers.'},400);
 if(!await limit(db,`peptalk:${member.id}:${Math.floor(now/3600000)}`,10))return json({error:'Please wait before scheduling more messages.'},429);
 const claimed=await db.prepare("INSERT INTO peptalk_jobs(id,author,author_id,body,send_at,created,state) VALUES(?,?,?,?,?,?,'submitting') ON CONFLICT(id) DO NOTHING RETURNING id").bind(b.id,member.name,member.id,message,sendAt,now).first();if(!claimed)return json({success:true,existing:true});
 await db.batch(people.map(p=>db.prepare("INSERT INTO peptalk_deliveries(job_id,phone,status) VALUES(?,?,'pending')").bind(b.id,p.phone)));
 const outgoing=`Kanab Sports · Team D — ${member.name}\n\n${message}\n\nReply STOP to opt out.`;
 // Persist each claim before the network call. Never blindly retry a potentially accepted SMS.
 for(const p of people){
 await db.prepare("UPDATE peptalk_deliveries SET status='unknown' WHERE job_id=? AND phone=?").bind(b.id,p.phone).run();
 try{const d=await twilio(env,'',{To:p.phone,MessagingServiceSid:settings.service,Body:outgoing,ScheduleType:'fixed',SendAt:new Date(sendAt).toISOString()});
 if(!/^SM[a-f0-9]{32}$/i.test(d.sid||''))throw Error('Unexpected response');
 await db.prepare('UPDATE peptalk_deliveries SET sid=?,status=?,error=NULL WHERE job_id=? AND phone=?').bind(d.sid,d.status||'unknown',b.id,p.phone).run();
 }catch(e){await db.prepare('UPDATE peptalk_deliveries SET status=?,error=? WHERE job_id=? AND phone=?').bind(e.definite?'failed':'unknown',e.code?String(e.code):'Check Twilio logs before retrying',b.id,p.phone).run();}
 }
 await db.prepare("UPDATE peptalk_jobs SET state='ready' WHERE id=?").bind(b.id).run();return json({success:true});
 }
 if(b.action==='cancel'||b.action==='refresh'){
 const j=await db.prepare('SELECT * FROM peptalk_jobs WHERE id=?').bind(b.id).first();if(!j)return json({error:'Message not found.'},404);
 if(j.state==='submitting')return json({error:'Scheduling is still processing. Refresh shortly. If it stays here, check Twilio logs before retrying.'},409);
 const rows=(await db.prepare("SELECT phone,sid,status FROM peptalk_deliveries WHERE job_id=? AND sid IS NOT NULL AND status NOT IN ('canceled','delivered','failed','undelivered')").bind(b.id).all()).results||[];
 for(const r of rows){try{const d=await twilio(env,'/'+r.sid,b.action==='cancel'?{Status:'canceled'}:undefined);await db.prepare('UPDATE peptalk_deliveries SET status=?,error=NULL WHERE job_id=? AND phone=?').bind(d.status||r.status,j.id,r.phone).run();}catch(e){await db.prepare('UPDATE peptalk_deliveries SET error=? WHERE job_id=? AND phone=?').bind(e.code?String(e.code):'Could not confirm status',j.id,r.phone).run();}}
 const unresolved=await db.prepare("SELECT count(*) AS n FROM peptalk_deliveries WHERE job_id=? AND (error IS NOT NULL OR status IN ('unknown','pending'))").bind(j.id).first();
 return json({success:true,warning:unresolved.n?'Some statuses could not be confirmed. Check Twilio logs before rescheduling.':null});
 }
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Could not finish this request. Refresh the scheduled list before trying again to avoid duplicate texts.'},500);}
}

const TEAM='britt-soccer';
const PLAYERS=['Logan Welch','Verity Henke','Lennon Brown','Kelby Wheeler','Nora LeFevre','Harper Penney','Grai Reese','Carter Bunting','Yotam Binyamini','Finn Roth','Bryson Palmer'];
export async function onRequestPost({request,env}){
 if(!env.SPORTS_DB)return xml('Kanab Sports enrollment is temporarily unavailable.');
 await schema(env.SPORTS_DB);
 const form=await request.formData(),from=String(form.get('From')||'').trim(),body=String(form.get('Body')||'').trim();
 if(!from)return xml('Kanab Sports could not identify your phone number.');
 let row=await env.SPORTS_DB.prepare('SELECT * FROM sms_enrollment WHERE phone=? AND team=?').bind(from,TEAM).first();
 const upper=body.toUpperCase();
 if(upper==='HELP')return xml('Kanab Sports team texts help: team practices, games, changes and announcements. Reply STOP to opt out. Visit kanabsports.com/team/britt/ or contact your coach.');
 if(upper==='STOP'||upper==='UNSUBSCRIBE'||upper==='CANCEL'||upper==='END'||upper==='QUIT'){
   await env.SPORTS_DB.prepare("UPDATE sms_enrollment SET status='opted_out',opted_out_at=datetime('now'),updated_at=datetime('now') WHERE phone=? AND team=?").bind(from,TEAM).run();
   return xml('Kanab Sports: You are unsubscribed from team texts. Reply JOIN if you want to enroll again.');
 }
 if(upper==='JOIN'||!row){
   await env.SPORTS_DB.prepare("INSERT INTO sms_enrollment(phone,team,status,step,consent_started_at,updated_at) VALUES(?,?,'pending','confirm',datetime('now'),datetime('now')) ON CONFLICT(phone,team) DO UPDATE SET status='pending',step='confirm',guardian_name=NULL,player_name=NULL,player_match=NULL,consent_started_at=datetime('now'),updated_at=datetime('now')").bind(from,TEAM).run();
   return xml('Kanab Sports — Coach Britt soccer team texts. Recurring operational messages include practices, games, schedule changes, cancellations and team announcements. Message frequency varies. Message & data rates may apply. Reply HELP for help or STOP to opt out. Privacy: kanabsports.com/privacy Terms: kanabsports.com/terms Reply Y to confirm you want to enroll.');
 }
 if(row.step==='confirm'){
   if(!['Y','YES'].includes(upper))return xml('Kanab Sports: Reply Y to confirm enrollment, or STOP to cancel.');
   await env.SPORTS_DB.prepare("UPDATE sms_enrollment SET status='consented',step='guardian',consented_at=datetime('now'),updated_at=datetime('now') WHERE phone=? AND team=?").bind(from,TEAM).run();
   return xml('Thanks! What is your full parent/guardian name? Reply with first and last name.');
 }
 if(row.step==='guardian'){
   if(body.length<3)return xml('Please reply with the parent/guardian full name (first and last name).');
   await env.SPORTS_DB.prepare("UPDATE sms_enrollment SET guardian_name=?,step='player',updated_at=datetime('now') WHERE phone=? AND team=?").bind(body,from,TEAM).run();
   return xml("Thanks. What is your player's full name? Reply with first and last name.");
 }
 if(row.step==='player'){
   const match=matchPlayer(body);
   await env.SPORTS_DB.prepare("UPDATE sms_enrollment SET player_name=?,player_match=?,match_status=?,step='complete',completed_at=datetime('now'),updated_at=datetime('now') WHERE phone=? AND team=?").bind(body,match||null,match?'matched':'needs_review',from,TEAM).run();
   if(match)return xml('You’re all set! Kanab Sports — Coach Britt soccer team texts are active for '+match+'. Recurring team updates; message frequency varies. Message & data rates may apply. Reply HELP for help or STOP to opt out.');
   return xml("You're enrolled in Kanab Sports — Coach Britt soccer team texts. We couldn't automatically match that player name to the roster, so Coach Britt or Coach Jodi will review it. Message frequency varies. Message & data rates may apply. Reply HELP for help or STOP to opt out.");
 }
 return xml('Kanab Sports: Your team-text enrollment is active. Reply HELP for help or STOP to opt out.');
}
export async function onRequestGet({request,env}){
 if(!env.SPORTS_DB)return json({success:false},503);
 const u=new URL(request.url),phone=u.searchParams.get('phone');
 if(!phone)return json({success:false,error:'phone required'},400);
 await schema(env.SPORTS_DB);const r=await env.SPORTS_DB.prepare('SELECT status,step,guardian_name,player_name,player_match,match_status,consented_at,completed_at FROM sms_enrollment WHERE phone=? AND team=?').bind(phone,TEAM).first();
 return json({success:true,enrollment:r||null});
}
function matchPlayer(v){const n=norm(v),exact=PLAYERS.filter(p=>norm(p)===n);if(exact.length===1)return exact[0];return null}
function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
async function schema(db){await db.prepare("CREATE TABLE IF NOT EXISTS sms_enrollment(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,team TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',step TEXT NOT NULL DEFAULT 'confirm',guardian_name TEXT,player_name TEXT,player_match TEXT,match_status TEXT,consent_started_at TEXT,consented_at TEXT,completed_at TEXT,opted_out_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(phone,team))").run()}
function xml(message){const esc=String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Message>'+esc+'</Message></Response>',{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}})}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

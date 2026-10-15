import {authenticate} from './admin-dashboard.js';
import {pilotSchema} from '../_lib/pilot-schema.js';
import {teamPolicy} from '../_lib/school-access.js';
import {json,clean} from '../_lib/coach-auth.js';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Pilot tracking unavailable.'},503);
 try{if(!await authenticate(request,db))return json({error:'Sign in to the owner console.'},401);await pilotSchema(db);
 await db.prepare("INSERT OR IGNORE INTO pep_pilots(id,name) VALUES('kanab-first-pilot','Kanab first pilot')").run();
 const pilot=await db.prepare("SELECT * FROM pep_pilots WHERE id='kanab-first-pilot'").first();
 if(request.method==='GET'){
 const month=new URL(request.url).searchParams.get('month')||new Date().toISOString().slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json({error:'Choose a valid month.'},400);
 const codes=JSON.parse(pilot.team_codes),allowed=[];for(const code of codes){const policy=await teamPolicy(db,code);if(policy&&['rec','travel'].includes(policy.kind))allowed.push(code)}
 const activity=await db.prepare("SELECT COUNT(DISTINCT family_hash) n FROM pep_family_activity WHERE team_code IN (SELECT value FROM json_each(?)) AND substr(day,1,7)=? AND (? IS NULL OR day>=?) AND (? IS NULL OR day<=?)").bind(JSON.stringify(allowed),month,pilot.start_date,pilot.start_date,pilot.end_date,pilot.end_date).first();
 const entries=(await db.prepare('SELECT * FROM pep_pilot_entries WHERE pilot_id=? ORDER BY date DESC,created DESC').bind(pilot.id).all()).results||[];
 const renewals=(await db.prepare('SELECT * FROM pep_pilot_renewals WHERE pilot_id=? ORDER BY date DESC,created DESC').bind(pilot.id).all()).results||[];
 return json({success:true,pilot:{...pilot,team_codes:codes},month,activeFamilies:pilot.start_date?Number(activity.n):null,entries,renewals,trackingDefinition:'Unique verified parent accounts that opened an authorized rec/travel team in My Family during this month and within pilot dates. Two guardian accounts count separately. Calendar polling and driver links do not count. Tracking starts October 15, 2026; no historical activity is inferred.'});
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open the owner console to update pilot tracking.'},403);
 const raw=await request.text();if(raw.length>6000)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(b.action==='configure'){
 const codes=[...new Set(String(b.team_codes||'').split(/[\s,]+/).filter(Boolean))];if(codes.length>20||codes.some(c=>!/^KS-[A-Z0-9_-]{1,29}$/.test(c)))return json({error:'Enter up to 20 active coach team codes.'},400);
 for(const code of codes){const policy=await teamPolicy(db,code);if(!policy||!['rec','travel'].includes(policy.kind))return json({error:'This city pilot accepts approved rec/travel teams only. School metrics remain outside this tracker.'},400);if(!await db.prepare("SELECT id FROM coach_access_requests WHERE team_code=? AND status='approved'").bind(code).first())return json({error:'That team has no approved coach.'},400)}
 const status=b.status;if(!['draft','active','review','closed'].includes(status)||!validDate(b.start_date)||!validDate(b.end_date)||b.end_date<b.start_date||(!codes.length&&status!=='draft'))return json({error:'Choose a valid date range and at least one team before activating the pilot.'},400);
 await db.prepare('UPDATE pep_pilots SET team_codes=?,start_date=?,end_date=?,status=? WHERE id=?').bind(JSON.stringify(codes),b.start_date,b.end_date,status,pilot.id).run();return json({success:true});
 }
 const id=clean(b.id,80);if(!/^[a-zA-Z0-9_-]{12,80}$/.test(id))return json({error:'A valid entry reference is required.'},400);
 if(b.action==='log'){
 if(!['onboarding_minutes','support_minutes','communication_cents','staff_minutes','repeat_questions'].includes(b.kind)||!validDate(b.date)||!Number.isSafeInteger(b.quantity)||b.quantity<0||b.quantity>100000000||!clean(b.note,500))return json({error:'Enter a valid date, nonnegative whole quantity and a short source or work note.'},400);
 const prior=await db.prepare('SELECT * FROM pep_pilot_entries WHERE id=?').bind(id).first();if(prior&&(prior.kind!==b.kind||prior.date!==b.date||prior.quantity!==b.quantity||prior.note!==clean(b.note,500)))return json({error:'This reference already belongs to a different entry. Refresh before retrying.'},409);
 await db.prepare('INSERT OR IGNORE INTO pep_pilot_entries VALUES(?,?,?,?,?,?,0,?)').bind(id,pilot.id,b.date,b.kind,b.quantity,clean(b.note,500),Date.now()).run();return json({success:true});
 }
 if(['void','restore'].includes(b.action)){await db.prepare('UPDATE pep_pilot_entries SET voided=? WHERE id=? AND pilot_id=?').bind(b.action==='void'?1:0,id,pilot.id).run();return json({success:true})}
 if(b.action==='renewal'){
 if(!validDate(b.date)||!['pending','renew','extend','decline'].includes(b.decision)||!clean(b.reason,500))return json({error:'Record the decision date, outcome and reason.'},400);
 const prior=await db.prepare('SELECT * FROM pep_pilot_renewals WHERE id=?').bind(id).first();if(prior&&(prior.decision!==b.decision||prior.date!==b.date||prior.reason!==clean(b.reason,500)))return json({error:'That decision reference is already used.'},409);
 await db.prepare('INSERT OR IGNORE INTO pep_pilot_renewals VALUES(?,?,?,?,?,?)').bind(id,pilot.id,b.date,b.decision,clean(b.reason,500),Date.now()).run();return json({success:true});
 }
 return json({error:'Unknown action.'},400);
 }catch{return json({error:'Could not load or save pilot tracking. Retry with the same entry before adding another.'},500)}
}

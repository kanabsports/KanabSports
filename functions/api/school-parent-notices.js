import {schoolSchema,schoolAudit,trustedOrigin} from '../_lib/school-access.js';
import {accessSchema,parentSession} from '../_lib/parent-access.js';
import {json} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unavailable.'},503);
 try{
 await accessSchema(db);await schoolSchema(db);const parent=await parentSession(request,db);if(!parent)return json({error:'Sign in to My Family.'},401);
 if(request.method==='GET')return json({notices:(await db.prepare("SELECT n.id,n.student_name,n.old_sport,n.new_sport,n.team_code,n.school_year,n.status FROM school_parent_notices n JOIN school_teams t ON t.team_code=n.team_code AND t.school_year=n.school_year WHERE n.email=? AND (n.status='new' OR ?=1) AND t.expires>date('now') ORDER BY n.created DESC LIMIT 50").bind(parent.email,new URL(request.url).searchParams.get('all')==='1'?1:0).all()).results||[]});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!trustedOrigin(request))return json({error:'Open My Family.'},403);
 const raw=await request.text();if(raw.length>1000)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(!['opt_out','dismiss'].includes(b.action))return json({error:'Unknown action.'},400);
 const notice=await db.prepare('SELECT * FROM school_parent_notices WHERE id=? AND email=?').bind(String(b.id||''),parent.email).first();if(!notice)return json({error:'Notice not found.'},404);
 if(b.action==='dismiss'){await db.prepare("UPDATE school_parent_notices SET status='dismissed' WHERE id=? AND email=? AND status='new'").bind(notice.id,parent.email).run();return json({success:true})}
 await db.batch([db.prepare('INSERT OR IGNORE INTO school_parent_optouts VALUES(?,?,?,?,?,?)').bind(parent.email,notice.school_id,notice.school_year,notice.team_code,notice.student_ref,Date.now()),db.prepare("UPDATE school_parent_notices SET status='opted_out' WHERE email=? AND school_id=? AND school_year=? AND team_code=? AND student_ref=?").bind(parent.email,notice.school_id,notice.school_year,notice.team_code,notice.student_ref),schoolAudit(db,notice.school_id,notice.team_code,parent.email,'parent_opt_out',notice.student_ref)]);
 return json({success:true,message:'You will no longer receive private team messages through this student’s membership. Other children’s memberships on the same team may still give you access.'});
 }catch{return json({error:'Your preference could not be saved. Please try again.'},500)}
}

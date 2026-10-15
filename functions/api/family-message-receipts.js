import {accessSchema,parentSession,hasMembership} from '../_lib/parent-access.js';
import {pilotSchema} from '../_lib/pilot-schema.js';
import {json} from '../_lib/coach-auth.js';
export async function onRequestPost({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Updates unavailable.'},503);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open My Family to acknowledge an update.'},403);
 try{await accessSchema(db);const parent=await parentSession(request,db);if(!parent)return json({error:'Sign in to acknowledge updates across devices.'},401);const raw=await request.text();if(raw.length>1000)return json({error:'Request too large.'},413);const b=JSON.parse(raw);if(typeof b.team_code!=='string'||typeof b.message_id!=='string'||b.message_id.length>100)return json({error:'Invalid update.'},400);
 if(!await hasMembership(db,parent.email,b.team_code))return json({error:'Team access is no longer approved.'},403);
 if(!await db.prepare('SELECT id FROM coach_team_messages WHERE id=? AND team_code=?').bind(b.message_id,b.team_code).first())return json({error:'Update not found.'},404);
 await pilotSchema(db);await db.prepare('INSERT OR IGNORE INTO pep_message_receipts VALUES(?,?,?,?)').bind(b.team_code,b.message_id,parent.email,Date.now()).run();return json({success:true});
 }catch{return json({error:'Could not save acknowledgment. Please retry.'},500)}
}

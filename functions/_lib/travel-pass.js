import {sha256} from './coach-auth.js';
import {schoolSchema} from './school-access.js';

// Only this one invitation can start a temporary travel-team account.
export const passId='travel-invite-2026-11-01';
export async function matchesPass(email,organization,sport){
 return organization==='Travel'&&/\bbasketball\b/i.test(sport)&&await sha256(email.toLowerCase().trim())==='5bcb341b313ba840fc0fbc94ea81546bdf7c8b51cd359ab18bb555ed1a56a2f2';
}
export const eligibleSetup=`(status='approved' OR (id='${passId}' AND status='pending' AND review_token_hash IS NOT NULL AND datetime(review_expires_at)>datetime('now')))`;
export const beforeExpiry=`(id<>'${passId}' OR review_token_hash IS NULL OR status='pending' OR datetime(reviewed_at,'+72 hours')>datetime('now'))`;
export async function reserveTeam(db){
 await schoolSchema(db);
 for(let i=0;i<12;i++){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code='KS-'+Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>alphabet[b%alphabet.length]).join('');
  const r=await db.prepare(`UPDATE coach_access_requests SET team_code=COALESCE(team_code,?) WHERE id=?
    AND NOT EXISTS(SELECT 1 FROM coach_access_requests WHERE team_code=?)
    AND NOT EXISTS(SELECT 1 FROM school_teams WHERE team_code=?) RETURNING team_code`).bind(code,passId,code,code).first();
  if(r)return;
 }
 throw Error('Could not reserve team code');
}
export function classifyTravel(db){
 return db.prepare(`INSERT OR IGNORE INTO school_teams(team_code,kind,school_id,evidence,assigned_by)
 SELECT team_code,'travel',NULL,'Owner invitation for a travel team','owner-invite' FROM coach_access_requests WHERE id=? AND status='approved' AND team_code IS NOT NULL`).bind(passId);
}
const nextCheck=new WeakMap();
export async function expirePass(db){
 const now=Date.now();if((nextCheck.get(db)||0)>now)return;
 try{
  const row=await db.prepare(`SELECT unixepoch(reviewed_at,'+72 hours') AS deadline FROM coach_access_requests
   WHERE id=? AND status='approved' AND review_token_hash IS NOT NULL`).bind(passId).first();
  if(row&&row.deadline*1000<=now)await db.prepare(`UPDATE coach_access_requests SET status='pass_expired' WHERE id=? AND status='approved' AND review_token_hash IS NOT NULL AND datetime(reviewed_at,'+72 hours')<=datetime('now')`).bind(passId).run();
  nextCheck.set(db,Math.min(now+30000,row?row.deadline*1000:Infinity));
 }catch(e){if(!String(e.message).includes('no such table: coach_access_requests'))throw e;}
}

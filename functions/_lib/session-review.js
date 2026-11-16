import {sha256,json} from './coach-auth.js';
import {syncAssistantAccess} from './assistant-coaches.js';
import {passId} from './travel-pass.js';
export const DAY=86400000,DEVICE_SECONDS=180*86400;
const configs={owner:{cookie:'ks_admin',table:'admin_sessions',hash:'token_hash',expires:'expires_at',sameSite:'Strict'},coach:{cookie:'ks_coach',table:'coach_sessions',hash:'token_hash',expires:'expires_at',sameSite:'Lax'},parent:{cookie:'__Host-ks_parent',table:'parent_sessions',hash:'hash',expires:'expires',sameSite:'Strict'}};
export async function reviewSchema(db){await db.prepare('CREATE TABLE IF NOT EXISTS session_reviews(role TEXT NOT NULL,token_hash TEXT NOT NULL,review_at INTEGER NOT NULL,PRIMARY KEY(role,token_hash))').run();}
export async function registerReview(db,role,hash,now=Date.now()){await reviewSchema(db);await db.prepare('INSERT OR IGNORE INTO session_reviews(role,token_hash,review_at) VALUES(?,?,?)').bind(role,hash,now+7*DAY).run();}
export function nextReview(period,now=Date.now()){
 if(period==='week')return now+7*DAY;
 const months={month:1,three_months:3,six_months:6}[period];if(!months)return null;
 const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.getTime();
}
export async function activeSessions(request,db){
 const result=[],cookies=request.headers.get('Cookie')||'';
 for(const [role,c] of Object.entries(configs)){
  const match=cookies.match(new RegExp('(?:^|;\\s*)'+c.cookie+'=([^;]+)'));if(!match)continue;
  let token;try{token=decodeURIComponent(match[1])}catch{continue}if(token.length>200)continue;
  if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(c.table).first())continue;
  const hash=await sha256(token);
  if(role==='coach')await syncAssistantAccess(db);
  const query=role==='coach'?`SELECT s.expires_at,a.id,a.review_token_hash FROM coach_sessions s JOIN coach_access_requests a ON a.id=s.coach_id WHERE s.token_hash=? AND a.status='approved' AND datetime(s.expires_at)>datetime('now')`:
   role==='owner'?"SELECT expires_at FROM admin_sessions WHERE token_hash=? AND email='howdy@kanabsports.com' AND datetime(expires_at)>datetime('now')":'SELECT expires FROM parent_sessions WHERE hash=? AND expires>?';
  const row=await db.prepare(query).bind(...(role==='parent'?[hash,Date.now()]:[hash])).first();if(!row)continue;
  const expires=role==='parent'?Number(row.expires):Date.parse(row.expires_at.endsWith('Z')?row.expires_at:row.expires_at.replace(' ','T')+'Z');
  result.push({role,config:c,token,hash,expires,limited:role==='coach'&&row.id===passId&&!!row.review_token_hash});
 }
 return result;
}
export async function pendingReviews(request,db){
 if(!db||!/(?:^|;\s*)(?:ks_admin|ks_coach|__Host-ks_parent)=/.test(request.headers.get('Cookie')||''))return [];
 await reviewSchema(db);const due=[];
 for(const [role,c] of Object.entries(configs)){
  const match=(request.headers.get('Cookie')||'').match(new RegExp('(?:^|;\\s*)'+c.cookie+'=([^;]+)'));if(!match)continue;
  let token;try{token=decodeURIComponent(match[1])}catch{continue}if(token.length>200)continue;
  const row=await db.prepare('SELECT review_at FROM session_reviews WHERE role=? AND token_hash=?').bind(role,await sha256(token)).first();
  if(row&&row.review_at<=Date.now())due.push(role);
 }
 if(!due.length)return [];
 const sessions=await activeSessions(request,db);return due.filter(role=>sessions.some(s=>s.role===role));
}
export const reviewRequired=()=>json({success:false,code:'SESSION_REVIEW_REQUIRED',error:'Please confirm whether you want to stay signed in on this device.'},428);
export function injectReview(html){return html.replace(/<head[^>]*>/i,m=>m+'<script src="/assets/session-review.js"></script>');}
export async function extendSession(db,s,until){
 const expiry=s.limited?Math.min(until,s.expires):until,c=s.config;
 const where=s.role==='parent'?`${c.expires}>?`:`datetime(${c.expires})>datetime('now')`;
 const args=[s.role==='parent'?expiry:new Date(expiry).toISOString(),s.hash];if(s.role==='parent')args.push(Date.now());
 const saved=await db.prepare(`UPDATE ${c.table} SET ${c.expires}=? WHERE ${c.hash}=? AND ${where} RETURNING ${c.hash}`).bind(...args).first();
 return saved?expiry:null;
}
export function sessionCookie(s,expiry){return `${s.config.cookie}=${encodeURIComponent(s.token)}; Path=/; HttpOnly; Secure; SameSite=${s.config.sameSite}; Max-Age=${Math.max(0,Math.floor((expiry-Date.now())/1000))}`;}
export async function revokeSession(db,s){await db.prepare(`DELETE FROM ${s.config.table} WHERE ${s.config.hash}=?`).bind(s.hash).run();await db.prepare('DELETE FROM session_reviews WHERE role=? AND token_hash=?').bind(s.role,s.hash).run();}

import {activeSessions,reviewSchema,registerReview,nextReview,extendSession,sessionCookie,revokeSession,DAY} from '../_lib/session-review.js';
import {json} from '../_lib/coach-auth.js';
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'Sign-in preferences are unavailable.'},503);
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
 if(request.method==='POST'&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open Kanab Sports to update your sign-in.'},403);
 const db=env.SPORTS_DB,sessions=await activeSessions(request,db);await reviewSchema(db);
 if(request.method==='GET'){
  const cookies=[],list=[];
  for(const s of sessions){
   let row=await db.prepare('SELECT review_at FROM session_reviews WHERE role=? AND token_hash=?').bind(s.role,s.hash).first();
   // One-time migration for an existing, still-valid login. Never revive an expired one.
   if(!row){await registerReview(db,s.role,s.hash);row={review_at:Date.now()+7*DAY};const expiry=await extendSession(db,s,Date.now()+180*DAY);if(expiry)cookies.push(sessionCookie(s,expiry));}
   list.push({role:s.role,reviewAt:row.review_at,due:row.review_at<=Date.now()});
  }
  const response=json({sessions:list});for(const cookie of cookies)response.headers.append('Set-Cookie',cookie);return response;
 }
 const raw=await request.text();if(raw.length>1000)return json({error:'Invalid request.'},413);
 let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 const s=sessions.find(s=>s.role===b.role);if(!s)return json({error:'This login has expired or was signed out. Please sign in again.'},401);
 if(b.action==='logout'){
  await revokeSession(db,s);const response=json({success:true});response.headers.set('Set-Cookie',sessionCookie(s,0));if(s.role==='owner')response.headers.append('Set-Cookie','ks_owner_demo=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return response;
 }
 const reviewAt=nextReview(b.period);if(b.action!=='continue'||!reviewAt)return json({error:'Choose one week, one month, three months, or six months.'},400);
 const expiry=await extendSession(db,s,reviewAt+180*DAY);if(!expiry)return json({error:'Please sign in again.'},401);
 await db.prepare('INSERT INTO session_reviews(role,token_hash,review_at) VALUES(?,?,?) ON CONFLICT(role,token_hash) DO UPDATE SET review_at=excluded.review_at').bind(s.role,s.hash,reviewAt).run();
 const response=json({success:true,reviewAt});response.headers.set('Set-Cookie',sessionCookie(s,expiry));return response;
}

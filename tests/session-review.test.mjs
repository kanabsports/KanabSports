import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sha256,ensureCoachCore} from '../functions/_lib/coach-auth.js';
import {registerReview,pendingReviews,nextReview,DAY,injectReview} from '../functions/_lib/session-review.js';
import {onRequest as review} from '../functions/api/session-review.js';
import {onRequest as middleware} from '../functions/_middleware.js';
const sql=new DatabaseSync(':memory:');
const db={prepare(q){const st=sql.prepare(q);let args=[];return {bind(...v){args=v;return this},async run(){return {meta:{changes:st.run(...args).changes}}},async first(){return st.get(...args)||null},async all(){return {results:st.all(...args)}}}}};
const env={SPORTS_DB:db},origin='https://kanabsports.com',base=Date.now(),realNow=Date.now;
await ensureCoachCore(db);
sql.exec("CREATE TABLE admin_sessions (id TEXT PRIMARY KEY,email TEXT,token_hash TEXT,expires_at TEXT,created_at TEXT);CREATE TABLE parent_sessions (hash TEXT PRIMARY KEY,email TEXT,expires INTEGER)");
const tokens={owner:'a'.repeat(64),coach:'b'.repeat(64),parent:'c'.repeat(64)},hashes={};
for(const [role,t] of Object.entries(tokens))hashes[role]=await sha256(t);
sql.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?)').run('owner','howdy@kanabsports.com',hashes.owner,new Date(base+180*DAY).toISOString(),new Date(base).toISOString());
sql.prepare("INSERT INTO coach_access_requests(id,name,email,organization,sport,role,status) VALUES('coach','Fixture Coach','coach@example.invalid','Fixture','Basketball','Head Coach','approved')").run();
sql.prepare('INSERT INTO coach_sessions(id,coach_id,email,token_hash,expires_at) VALUES(?,?,?,?,?)').run('coach','coach','coach@example.invalid',hashes.coach,new Date(base+180*DAY).toISOString());
sql.prepare('INSERT INTO parent_sessions VALUES(?,?,?)').run(hashes.parent,'parent@example.invalid',base+180*DAY);
for(const role of Object.keys(tokens))await registerReview(db,role,hashes[role],base);
const names={owner:'ks_admin',coach:'ks_coach',parent:'__Host-ks_parent'};
const req=(role,body,path='/api/session-review',from=origin)=>new Request(origin+path,{method:body?'POST':'GET',headers:{Cookie:names[role]+'='+tokens[role],Origin:from,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const call=(role,body)=>review({env,request:req(role,body)});
try{
 Date.now=()=>base+6*DAY;
 for(const role of Object.keys(tokens))assert.deepEqual(await pendingReviews(req(role),db),[]);
 Date.now=()=>base+7*DAY;
 for(const role of Object.keys(tokens))assert.deepEqual(await pendingReviews(req(role),db),[role]);
 Date.now=()=>base+56*DAY;
 for(const role of Object.keys(tokens)){
  const before=await (await call(role)).json();assert.equal(before.sessions[0].due,true);
  let nextCalled=false;
  const guarded=await middleware({env,request:req(role,{action:'post'},'/api/coach-messages'),next:()=>{nextCalled=true;}});
  assert.equal(guarded.status,428);assert.equal(nextCalled,false);
  const saved=await call(role,{role,action:'continue',period:'six_months'});assert.equal(saved.status,200);assert.match(saved.headers.get('Set-Cookie'),/HttpOnly; Secure/);
  const after=await saved.json();assert.equal(after.reviewAt,nextReview('six_months',base+56*DAY));assert.deepEqual(await pendingReviews(req(role),db),[]);
  const repeat=await (await call(role)).json();assert.equal(repeat.sessions[0].reviewAt,after.reviewAt); // visits do not slide the date
 }
 assert.equal(nextReview('month',Date.UTC(2027,0,31)),Date.UTC(2027,1,28));
 assert.equal(nextReview('six_months',Date.UTC(2026,7,31)),Date.UTC(2027,1,28));
 assert.equal((await call('owner',{role:'owner',action:'continue',period:'forever'})).status,400);
 assert.equal((await review({env,request:req('owner',{role:'owner',action:'continue',period:'week'},'/api/session-review','https://evil.invalid')})).status,403);
 assert.equal((await call('owner',{role:'parent',action:'continue',period:'week'})).status,401);
 const next=nextReview('six_months',base+56*DAY);Date.now=()=>next+1;
 assert.deepEqual(await pendingReviews(req('parent'),db),['parent']);
 const out=await call('parent',{role:'parent',action:'logout'});assert.equal(out.status,200);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await call('parent',{role:'parent',action:'continue',period:'week'})).status,401);
 sql.prepare("UPDATE admin_sessions SET expires_at='2000-01-01T00:00:00Z'").run();assert.equal((await call('owner',{role:'owner',action:'continue',period:'week'})).status,401);
 sql.prepare("UPDATE coach_access_requests SET status='revoked' WHERE id='coach'").run();assert.equal((await call('coach',{role:'coach',action:'continue',period:'week'})).status,401);
 assert.match(injectReview('<head><script>app()</script>'),/^<head><script src="\/assets\/session-review.js"><\/script><script>app/);
 console.log('PASS day 6, day 7 and day 56 for all roles; server-side gate; six-month fixed date; calendar month-end; CSRF; role isolation; expired/revoked/logout sessions cannot renew.');
}finally{Date.now=realNow;}

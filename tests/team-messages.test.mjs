import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/team-messages.js';

function database(){
 const sqlite=new DatabaseSync(':memory:');
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}});
 const db={prepare:wrap,async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 sqlite.exec(`CREATE TABLE coach_access_requests(id TEXT PRIMARY KEY,name TEXT,email TEXT,status TEXT,reviewed_at TEXT);CREATE TABLE coach_sessions(coach_id TEXT,token_hash TEXT,expires_at TEXT);`);
 return {db,sqlite};
}
test('team isolation, equal messaging, access management, attribution and revocation',async()=>{
 const {db,sqlite}=database();
 for(const id of ['head','assistant','outsider','pending']){
  sqlite.prepare('INSERT INTO coach_access_requests VALUES(?,?,?,?,?)').run(id,id,id+'@example.test',id==='pending'?'pending':'approved','2026-01-01');
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id))).toString('hex');
  sqlite.prepare('INSERT INTO coach_sessions VALUES(?,?,?)').run(id,hash,'2099-01-01');
 }
 const call=async(id,body,query='',origin='https://example.test')=>{const headers={Cookie:'ks_coach='+id};if(body){headers.Origin=origin;headers['Content-Type']='application/json'}const r=await onRequest({env:{SPORTS_DB:db},request:new Request('https://example.test/api/team-messages'+query,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined})});return {status:r.status,data:await r.json()}};
 assert.equal((await call('unknown')).status,401);
 assert.equal((await call('pending')).status,401);
 assert.equal((await call('head',{action:'create',name:'Team A'},'','https://evil.test')).status,403);
 const teamId=(await call('head',{action:'create',name:'Team A'})).data.teamId;
 assert.equal((await call('outsider',null,'?team='+teamId)).status,403);
 assert.equal((await call('outsider',{action:'send',teamId,message:'no',messageId:crypto.randomUUID()})).status,403);
 assert.equal((await call('head',{action:'add',teamId,email:'pending@example.test'})).status,400);
 assert.equal((await call('head',{action:'add',teamId,email:'assistant@example.test'})).status,200);
 assert.equal((await call('assistant',{action:'add',teamId,email:'outsider@example.test'})).status,403);
 assert.equal((await call('assistant',{action:'remove',teamId,coachId:'head'})).status,403);
 const message={action:'send',teamId,message:'Practice update',messageId:crypto.randomUUID(),sender:'Fake name',coach_id:'head'};
 assert.equal((await call('assistant',message)).status,200);
 assert.equal((await call('assistant',message)).status,200);
 let page=await call('head',null,'?team='+teamId);
 assert.equal(page.data.messages.length,1);assert.equal(page.data.messages[0].sender,'assistant');
 assert.equal((await call('head',{action:'send',teamId,message:'Thanks',messageId:crypto.randomUUID()})).status,200);
 assert.equal((await call('assistant',null,'?team='+teamId)).data.messages.length,2);
 assert.equal((await call('head',{action:'send',teamId,message:'x'.repeat(4001),messageId:crypto.randomUUID()})).status,400);
 for(let i=0;i<101;i++)await call('assistant',{action:'send',teamId,message:'Message '+i,messageId:crypto.randomUUID()});
 page=await call('head',null,'?team='+teamId);assert.equal(page.data.messages.length,100);assert.ok(page.data.older);
 const old=await call('head',null,'?team='+teamId+'&before='+page.data.older);assert.equal(old.data.messages.length,3);
 assert.equal((await call('head',{action:'remove',teamId,coachId:'assistant'})).status,200);
 assert.equal((await call('assistant',null,'?team='+teamId)).status,403);
 assert.equal((await call('assistant',{...message,messageId:crypto.randomUUID()})).status,403);
 assert.equal((await call('head',null,'?team='+teamId)).data.messages.length,100);
 sqlite.close();
});

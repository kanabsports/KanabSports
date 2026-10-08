import assert from 'node:assert/strict';
import {findBlockedWords,LANGUAGE_NOTE} from '../assets/pep-language.mjs';
import {onRequest} from '../functions/api/coach-messages.js';
for(const word of ['fuck','shit','asshole','cunt','goddamn','mother fucker','twat','FUCK','f.u.c.k','sh1t','f u c k','fuuuck','ＦＵＣＫ','bullshit','mother-fucking','f\u200bu\u200bc\u200bk'])assert.ok(findBlockedWords('Hey '+word+'!').length,word);
for(const word of ['class','assistant','Scunthorpe','Dick Smith','assessment','Pass the ball.','Practice at 4!'])assert.equal(findBlockedWords(word).length,0,word);
const text='🏀 ＦＵＣＫ and shit';assert.deepEqual(findBlockedWords(text).map(r=>text.slice(r.start,r.end)),['ＦＵＣＫ','shit']);
let inserts=0;
const db={prepare(sql){return {bind(){return this},async run(){if(sql.includes('INSERT INTO coach_team_messages'))inserts++;return {}},async first(){if(sql.includes('FROM coach_sessions'))return {id:'test',name:'Coach',team_code:'TEST',organization:'Test'};return {n:0}},async all(){return {results:[]}}}}};
for(const body of ['fuck','Practice: mother fucker']){
 const response=await onRequest({request:new Request('https://kanabsports.com/api/coach-messages',{method:'POST',headers:{cookie:'ks_coach=test',origin:'https://kanabsports.com','content-type':'application/json'},body:JSON.stringify({action:'post',body})}),env:{SPORTS_DB:db}});
 assert.equal(response.status,422);assert.equal((await response.json()).error,LANGUAGE_NOTE);
}
assert.equal(inserts,0,'Blocked content never reaches message storage');
console.log('Passed: language variants, false positives, highlight offsets and API rejection before storage.');

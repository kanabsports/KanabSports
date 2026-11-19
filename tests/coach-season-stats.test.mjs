import assert from 'node:assert/strict';
import {db,sqlite,env,tokens} from './private-messages.test.mjs';
import {onRequest as stats} from '../functions/api/score-details.js';
import {onRequest as sheets} from '../functions/api/season-sheet.js';
sqlite.exec("CREATE TABLE IF NOT EXISTS coach_submissions(id TEXT PRIMARY KEY,type TEXT,status TEXT,accountable_coach_id TEXT,opponent TEXT,event_date TEXT,result TEXT,team TEXT,created_at TEXT)");
sqlite.exec("INSERT INTO coach_submissions(id,type,status,accountable_coach_id,opponent,event_date,result,team) VALUES('fixture','Score','approved','coachA','Visitors','2026-11-19','40-30','Home')");
const origin='https://kanabsports.com';
async function call(fn,query,who,body){
 return fn({env,request:new Request(origin+'/api/test'+query,{method:body?'POST':'GET',headers:{Cookie:'ks_coach='+tokens[who],Origin:origin},body:body?JSON.stringify(body):undefined})});
}
const score='?id=fixture',draft={revision:0,details:'PTS 40  REB 18'};
assert.equal((await call(stats,score,'coachB',draft)).status,403);
assert.equal((await call(stats,score,'pending',draft)).status,403);
assert.equal((await call(stats,score,'coachA',draft)).status,200);
assert.equal((await call(stats,score,'coachA',draft)).status,409);
assert.equal((await (await call(stats,score+'&public=1')).json()).details,draft.details);
assert.equal((await (await call(stats,'','coachA')).json()).games.length,1);
const sheet={season:'Winter 2026',link:'https://docs.google.com/spreadsheets/d/fictional-sheet-2026/edit'};
assert.equal((await call(sheets,'','coachA',sheet)).status,200);
assert.equal((await call(sheets,'','schoolCoach',sheet)).status,403);
assert.equal((await (await call(sheets,'','assistantA')).json()).sheets.length,1);
assert.equal((await (await call(sheets,'','coachB')).json()).sheets.length,0);
console.log('PASS coach stats, team isolation, revision conflict, public details and team-season sheet.');
const {mapRoster}=await import('../assets/hudl-roster.mjs');
const hudl=mapRoster('jersey,firstname,lastname,classyear\n4,Avery,Sample,2027','Last Name,First Name,Jersey Number,Graduation Year,Email');
assert.equal(hudl.csv.split('\r\n')[1],'"Sample","Avery","4","2027",""');
assert.deepEqual(hudl.missing,['Email']);

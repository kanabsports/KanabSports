import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {kanabDate,eventExpired} from '../assets/event-dates.mjs';
import {onRequestGet as announcements} from '../functions/api/announcements.js';
import {onRequestGet as events} from '../functions/api/events.js';

assert.equal(kanabDate(new Date('2026-10-27T05:59:59Z')), '2026-10-26');
assert.equal(eventExpired('2026-10-26',new Date('2026-10-27T05:59:59Z')),false);
assert.equal(eventExpired('2026-10-26',new Date('2026-10-27T06:00:00Z')),true);
assert.equal(eventExpired('2026-10-26T18:00:00-06:00',new Date('2026-10-27T00:00:00Z')),true);
assert.equal(eventExpired('2026-10-26T18:00:00-06:00',new Date('2026-10-26T23:59:59Z')),false);
assert.equal(kanabDate(new Date('2026-11-02T06:59:59Z')),'2026-11-01');
assert.equal(kanabDate(new Date('2026-11-02T07:00:00Z')),'2026-11-02');

const sqlite=new DatabaseSync(':memory:');
const db={prepare(sql){let args=[];return {bind(...values){args=values;return this},async run(){return sqlite.prepare(sql).run(...args)},async all(){return {results:sqlite.prepare(sql).all(...args)}}}}};
const env={SPORTS_DB:db};
await announcements({env});await events({env});
const today=kanabDate(),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
for(const [id,start,end] of [['past',yesterday,null],['ended',yesterday,yesterday],['today',today,null],['multi',yesterday,today],['undated',null,null]]){
 sqlite.prepare("INSERT INTO site_announcements(id,source,sender_email,title,detail,status,event_date,end_date) VALUES(?,'test','test@example.test',?,'test','approved',?,?)").run(id,id,start,end);
}
let response=await announcements({env});
assert.deepEqual((await response.json()).announcements.map(r=>r.id).sort(),['multi','today','undated']);
assert.equal(response.headers.get('cache-control'),'no-store');
for(const [id,date] of [['past',yesterday],['today',today],['undated',null]])sqlite.prepare("INSERT INTO coach_submissions(id,source,type,status,event_date,opponent) VALUES(?,'test','Event','approved',?,'Halloween 5K')").run(id,date);
assert.deepEqual((await (await events({env})).json()).events.map(r=>r.id).sort(),['today','undated']);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM coach_submissions').get().n,3,'Public GET preserves event history');

// The homepage no longer publishes the expired clinic; dated cards start hidden.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(!html.includes('id="speedAgilityClinic"'));
assert.match(html,/id="chalk-walk" data-event-end="2026-10-26T18:00:00-06:00" hidden/);
assert.match(html,/data-event-end="2026-10-31" hidden/);
const cards=[{dataset:{eventEnd:yesterday}},{dataset:{eventEnd:today}}];
globalThis.document={querySelectorAll:()=>cards,addEventListener(){}};
const originalInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
const {refreshEvents}=await import('../assets/event-expiry.mjs');
refreshEvents(document,new Date(today+'T18:00:00Z'));
assert.equal(cards[0].hidden,true);assert.equal(cards[1].hidden,false);
globalThis.setInterval=originalInterval;
console.log('PASS: Kanab midnight/DST, exact end time, static cards, past/duration/undated feeds and preserved history.');

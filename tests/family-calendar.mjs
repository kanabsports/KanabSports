import assert from 'node:assert/strict';
import {CONNECTIONS,eventSort} from '../assets/family-connections.js';
import {onRequestGet} from '../functions/api/family-calendar.js';
const feed=codes=>onRequestGet({request:new Request('https://kanabsports.com/api/family-calendar?codes='+encodeURIComponent(codes))});
for(const code of ['TEAM-D','KANAB-HS']){const r=feed(code);assert.equal(r.status,200);const s=await r.text();assert(s.includes('BEGIN:VCALENDAR'));assert(s.includes(CONNECTIONS[code].events[0].id+'@kanabsports.com'));}
const both=await feed('TEAM-D,KANAB-HS,TEAM-D').text();assert.equal((both.match(/UID:team-d-0@/g)||[]).length,1);assert(both.includes('DTSTART;TZID=America/Denver:20261005T184500'));assert(both.includes('DTEND;VALUE=DATE:20261004'));assert(both.includes('BEGIN:VTIMEZONE'));for(const line of both.split('\r\n'))assert(Buffer.byteLength(line)<=75);
assert.equal(feed('UNKNOWN').status,400);assert.equal(feed('').status,400);
assert(eventSort({date:'2026-10-02',time:'9:00 AM',title:'A'},{date:'2026-10-02',time:'6:00 PM',title:'B'})<0);
console.log('PASS individual and combined calendar subscriptions, deduplication, Denver time, multiday dates, folding, validation, and schedule ordering.');

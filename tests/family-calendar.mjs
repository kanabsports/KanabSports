import assert from 'node:assert/strict';
import {CONNECTIONS,eventSort} from '../assets/family-connections.js';
import {onRequestGet} from '../functions/api/family-calendar.js';
const feed=codes=>onRequestGet({request:new Request('https://kanabsports.com/api/family-calendar?codes='+encodeURIComponent(codes))});
const codes=Object.keys(CONNECTIONS);assert.ok(codes.length);
for(const code of codes){const r=feed(code);assert.equal(r.status,200);const s=await r.text();assert(s.includes('BEGIN:VCALENDAR'));assert(s.includes(CONNECTIONS[code].events[0].id+'@kanabsports.com'));}
const both=await feed([...codes,...codes].join(',')).text();const uids=both.split('\r\n').filter(x=>x.startsWith('UID:'));assert.equal(new Set(uids).size,uids.length);assert(both.includes('BEGIN:VTIMEZONE'));for(const line of both.split('\r\n'))assert(Buffer.byteLength(line)<=75);
assert.equal(feed('UNKNOWN').status,400);assert.equal(feed('').status,400);
assert(eventSort({date:'2026-10-02',time:'9:00 AM',title:'A'},{date:'2026-10-02',time:'6:00 PM',title:'B'})<0);
console.log('PASS active public calendar subscriptions, deduplication, Denver timezone, UTF-8 folding, validation and schedule ordering.');

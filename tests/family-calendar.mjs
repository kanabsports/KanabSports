import assert from 'node:assert/strict';
import {CONNECTIONS,eventSort} from '../assets/family-connections.js';
import {onRequestGet} from '../functions/api/family-calendar.js';
const feed=codes=>onRequestGet({request:new Request('https://kanabsports.com/api/family-calendar?codes='+encodeURIComponent(codes))});
const r=await feed('KANAB-HS,KANAB-HS');assert.equal(r.status,200);const s=await r.text();assert(s.includes('BEGIN:VCALENDAR'));assert(s.includes(CONNECTIONS['KANAB-HS'].events[0].id+'@kanabsports.com'));assert.equal((s.match(/BEGIN:VEVENT/g)||[]).length,CONNECTIONS['KANAB-HS'].events.length);assert(s.includes('BEGIN:VTIMEZONE'));for(const line of s.split('\r\n'))assert(Buffer.byteLength(line)<=75);
assert.equal((await feed('UNKNOWN')).status,400);assert.equal((await feed('')).status,400);
assert(eventSort({date:'2026-10-02',time:'9:00 AM',title:'A'},{date:'2026-10-02',time:'6:00 PM',title:'B'})<0);
console.log('PASS public calendar, stable UIDs, deduplication, folding, removed-team rejection and ordering.');

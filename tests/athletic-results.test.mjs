import assert from 'node:assert/strict';
import {officialResults,isFreshWin} from '../assets/athletic-results.mjs';
const now=Date.parse('2026-10-17T18:00:00Z');
const r={id:'fictional-win',schoolId:2577,status:'official',kind:'team',sport:'Cross Country',place:1,team:'Kanab',meet:'Fictional Meet',division:'Varsity',date:'2026-10-17',publishedAt:'2026-10-17T17:00:00Z',sourceUrl:'https://www.athletic.net/CrossCountry/meet/123/results/456'};
assert.equal(officialResults({results:[r,r]},now).length,1);assert(isFreshWin(r,now));
for(const patch of [{status:'projection'},{status:'entries'},{schoolId:10},{sourceUrl:'https://athletic.net.evil.test/CrossCountry/meet/123/results/456'},{sourceUrl:'javascript:alert(1)'},{date:'2026-02-30'},{date:'2025-10-17'},{publishedAt:'2026-10-18T00:00:00Z'}])assert.equal(officialResults({results:[{...r,...patch}]},now).length,0);
assert(!isFreshWin({...r,place:3},now));assert(!isFreshWin({...r,date:'2026-10-14'},now));assert(!isFreshWin({...r,publishedAt:'2026-10-16T15:00:00Z'},now));
console.log('PASS official Kanab-only meet results, safe source links, duplicate rejection, dates, first-place and expiry gates.');

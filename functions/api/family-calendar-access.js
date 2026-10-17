import {accessSchema,parentSession} from '../_lib/parent-access.js';
import {calendarSchema} from '../_lib/family-calendar-access.js';
import {loadTeam} from './team-connection.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
import {sha256,json} from '../_lib/coach-auth.js';
export async function onRequestPost({request,env}){
 if(!env.SPORTS_DB)return json({error:'Calendar links are unavailable.'},503);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open My Family to manage calendar links.'},403);
 try{const db=env.SPORTS_DB;await accessSchema(db);const parent=await parentSession(request,db);if(!parent)return json({error:'Sign in to create a private calendar link.'},401);
 const raw=await request.text();if(raw.length>2000)return json({error:'Request too large.'},413);const body=JSON.parse(raw);await calendarSchema(db);
 if(body.action==='revoke'){await db.prepare('DELETE FROM family_calendar_tokens WHERE email=?').bind(parent.email).run();return json({success:true,message:'All private calendar links revoked. Calendar apps may retain events already downloaded.'})}
 if(body.action!=='create'||!Array.isArray(body.codes))return json({error:'Choose your teams.'},400);
 const codes=[...new Set(body.codes)];if(!codes.length||codes.length>20||codes.some(c=>typeof c!=='string'||!/^[A-Z0-9_-]{1,32}$/.test(c)))return json({error:'Invalid team selection.'},400);
 for(const code of codes){if(CONNECTIONS[code])continue;const r=await loadTeam({env,request:new Request(new URL('/api/team-connection?code='+encodeURIComponent(code),request.url))},parent);if(!r.ok)return json({error:'Team access needs approval before a calendar link can be created.'},403)}
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const expires=Date.now()+90*86400000;
 await db.prepare('DELETE FROM family_calendar_tokens WHERE expires<?').bind(Date.now()).run();
 const count=await db.prepare('SELECT COUNT(*) n FROM family_calendar_tokens WHERE email=?').bind(parent.email).first();if(count.n>=10)return json({error:'Revoke old links before creating another.'},409);
 await db.prepare('INSERT INTO family_calendar_tokens VALUES(?,?,?,?)').bind(await sha256(token),parent.email,JSON.stringify(codes),expires).run();
 return json({success:true,url:new URL('/api/family-calendar?token='+token,request.url).href,expires});
 }catch{return json({error:'Could not update calendar links.'},500)}
}

import {calendarPrincipal} from '../_lib/family-calendar-access.js';
import {loadTeam} from './team-connection.js';
import {interval} from '../../assets/family-event-times.mjs';
import {CONNECTIONS} from '../../assets/family-connections.js';
const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const day=v=>v.replaceAll('-','');
const nextDay=v=>new Date(Date.parse(v+'T12:00:00Z')+86400000).toISOString().slice(0,10);
// Fold by UTF-8 octets, without splitting a code point (RFC 5545).
function fold(line){let out='',part='',size=0;for(const c of line){const bytes=new TextEncoder().encode(c).length;if(size+bytes>75){out+=part+'\r\n';part=' ';size=1;}part+=c;size+=bytes;}return out+part;}
export async function onRequestGet({request,env={}}){
 try{
 const query=new URL(request.url).searchParams,token=query.get('token');
 const principal=token?await calendarPrincipal(env.SPORTS_DB,token):null;
 if(token&&!principal)return new Response('Calendar link expired or revoked.',{status:403,headers:{'Cache-Control':'no-store'}});
 const codes=principal?JSON.parse(principal.codes):[...new Set((query.get('codes')||'').split(',').filter(Boolean))];
 if(!codes.length||codes.length>20||(!principal&&codes.some(c=>!CONNECTIONS[c])))return new Response('Choose an active public calendar, or create a private link in My Family.',{status:400});
 const teams={};for(const code of codes){if(CONNECTIONS[code]){teams[code]=CONNECTIONS[code];continue}const response=await loadTeam({env,request:new Request(new URL('/api/team-connection?code='+encodeURIComponent(code),request.url))},principal);if(!response.ok)return new Response('Team calendar access is no longer available.',{status:403,headers:{'Cache-Control':'no-store'}});teams[code]=(await response.json()).team;}
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Pep//Family Schedule//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Kanab Sports · My Family','X-WR-TIMEZONE:America/Denver','BEGIN:VTIMEZONE','TZID:America/Denver','BEGIN:DAYLIGHT','DTSTART:20070311T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','TZOFFSETFROM:-0700','TZOFFSETTO:-0600','TZNAME:MDT','END:DAYLIGHT','BEGIN:STANDARD','DTSTART:20071104T020000','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','TZOFFSETFROM:-0600','TZOFFSETTO:-0700','TZNAME:MST','END:STANDARD','END:VTIMEZONE'];
 for(const code of codes){const t=teams[code];for(const e of t.events){
  const bounds=interval(e),multi=e.endDate&&e.endDate!==e.date;
  lines.push('BEGIN:VEVENT','UID:'+(CONNECTIONS[code]?'':code+'-')+e.id+'@kanabsports.com','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));
  if(bounds&&!multi){const stamp=n=>new Date(n*60000).toISOString().slice(0,19).replace(/[-:]/g,'');lines.push('DTSTART;TZID=America/Denver:'+stamp(bounds.start));if(bounds.end!==null)lines.push('DTEND;TZID=America/Denver:'+stamp(bounds.end));}
  else lines.push('DTSTART;VALUE=DATE:'+day(e.date),'DTEND;VALUE=DATE:'+day(nextDay(e.endDate||e.date)));
  lines.push('SUMMARY:'+escape(t.name+' · '+e.title),'DESCRIPTION:'+escape([e.time,e.detail,'Check Kanab Sports for the latest updates.'].filter(Boolean).join('\n')),'URL:https://kanabsports.com'+(e.url||t.url),'END:VEVENT');
 }}
 lines.push('END:VCALENDAR');return new Response(lines.map(fold).join('\r\n')+'\r\n',{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Disposition':'inline; filename="kanab-sports.ics"','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('Calendar temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}})}
}

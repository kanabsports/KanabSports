import {CONNECTIONS} from '../../assets/family-connections.js';
const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const day=v=>v.replaceAll('-','');
const nextDay=v=>new Date(Date.parse(v+'T12:00:00Z')+86400000).toISOString().slice(0,10);
// Fold by UTF-8 octets, without splitting a code point (RFC 5545).
function fold(line){let out='',part='',size=0;for(const c of line){const bytes=new TextEncoder().encode(c).length;if(size+bytes>75){out+=part+'\r\n';part=' ';size=1;}part+=c;size+=bytes;}return out+part;}
export function onRequestGet({request}){
 const codes=[...new Set((new URL(request.url).searchParams.get('codes')||'').split(',').filter(Boolean))];
 if(!codes.length||codes.length>20||codes.some(c=>!CONNECTIONS[c]))return new Response('Choose an active school or rec calendar.',{status:400});
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Pep//Family Schedule//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Kanab Sports · My Family','X-WR-TIMEZONE:America/Denver','BEGIN:VTIMEZONE','TZID:America/Denver','BEGIN:DAYLIGHT','DTSTART:20070311T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','TZOFFSETFROM:-0700','TZOFFSETTO:-0600','TZNAME:MDT','END:DAYLIGHT','BEGIN:STANDARD','DTSTART:20071104T020000','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','TZOFFSETFROM:-0600','TZOFFSETTO:-0700','TZNAME:MST','END:STANDARD','END:VTIMEZONE'];
 for(const code of codes){const t=CONNECTIONS[code];for(const e of t.events){
  const m=e.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i),multi=e.endDate&&e.endDate!==e.date;
  lines.push('BEGIN:VEVENT','UID:'+e.id+'@kanabsports.com','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));
  if(m&&!multi){const h=String(Number(m[1])%12+(m[3].toUpperCase()==='PM'?12:0)).padStart(2,'0');lines.push('DTSTART;TZID=America/Denver:'+day(e.date)+'T'+h+m[2]+'00');}
  else lines.push('DTSTART;VALUE=DATE:'+day(e.date),'DTEND;VALUE=DATE:'+day(nextDay(e.endDate||e.date)));
  lines.push('SUMMARY:'+escape(t.name+' · '+e.title),'DESCRIPTION:'+escape([e.time,e.detail,'Check Kanab Sports for the latest updates.'].filter(Boolean).join('\n')),'URL:https://kanabsports.com'+(e.url||t.url),'END:VEVENT');
 }}
 lines.push('END:VCALENDAR');return new Response(lines.map(fold).join('\r\n')+'\r\n',{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-cache','Content-Disposition':'inline; filename="kanab-sports.ics"','X-Content-Type-Options':'nosniff'}});
}

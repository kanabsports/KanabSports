import {TEAM_D} from './team-d-data.js';
import {footballData,crossCountryData,golfData,volleyballData} from './school-data.js';
export const categoryLabel = category => category === 'school' ? 'School' : 'Rec';
const schoolEvent=(id,date,time,title,detail='',endDate=date)=>({id,date,endDate,time,title,detail,type:'game',url:'/#high-school'});
const schoolEvents=[
 ...footballData.games.map(([level,date,opponent,venue,time,note],i)=>schoolEvent('football-'+i,'2026-'+date,time,`${level === 'Frosh'?'Freshman':level} Football · ${opponent}`,[venue,note].filter(Boolean).join(' · '))),
 ...volleyballData.events.flatMap((e,i)=>e.times.split(' · ').map((slot,j)=>schoolEvent('volleyball-'+i+'-'+j,e.start,'TBA',`Volleyball · ${e.title}`,slot+' · Confirm time with school',e.end))),
 ...crossCountryData.meets.map(([date,place,time,note],i)=>schoolEvent('crosscountry-'+i,date,time,'Cross Country · '+place,note)),
 ...golfData.events.map(([date,end,title,place,time],i)=>schoolEvent('golf-'+i,date,time,'Golf · '+title,place,end))
];
export const CONNECTIONS={
 'TEAM-D':{...TEAM_D,category:'rec',id:'team-d',coach:TEAM_D.coaches,color:'#e32636',messages:[],events:TEAM_D.events.map((e,i)=>({...e,id:'team-d-'+i}))},
 'KANAB-HS':{code:'KANAB-HS',category:'school',id:'kanab-hs',name:'Kanab High School',sport:'School sports · all listed levels',coach:[],color:'#e32636',url:'/#high-school',messages:[],events:schoolEvents}
};
export function timeMinutes(time){const m=String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);return m?(Number(m[1])%12+(m[3].toUpperCase()==='PM'?12:0))*60+Number(m[2]):1440;}
export const eventSort=(a,b)=>a.date.localeCompare(b.date)||timeMinutes(a.time)-timeMinutes(b.time)||a.title.localeCompare(b.title);
for(const t of Object.values(CONNECTIONS))t.events.sort(eventSort);

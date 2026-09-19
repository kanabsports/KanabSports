const SCHEDULE=[
 {date:'Mon, Sep 21',time:'6:45 PM',opponent:'Team C',coach:'Tami Van Dyke'},
 {date:'Mon, Sep 28',time:'6:45 PM',opponent:'Team B',coach:'Rhees Jackson'},
 {date:'Mon, Oct 5',time:'6:45 PM',opponent:'Team A',coach:'Amber Hooper'},
 {date:'Mon, Oct 12',time:'6:45 PM',opponent:'Team C',coach:'Tami Van Dyke'},
 {date:'Mon, Oct 26',time:'6:00 PM',opponent:'Team B',coach:'Rhees Jackson'},
 {date:'Mon, Nov 2',time:'6:45 PM',opponent:'Team A',coach:'Amber Hooper'}
];
export async function onRequestPost({request,env}){
 if(!env.SPORTS_DB)return json({success:false,error:'Database unavailable'},503);
 const {message}=await request.json(); const q=String(message||'').trim();
 if(!q)return json({success:false,error:'Ask a question first'},400);
 await schema(env.SPORTS_DB);
 const roster=(await env.SPORTS_DB.prepare("SELECT grade,player_name,parent_name,phone,jersey,sms_status FROM britt_team_roster ORDER BY player_name").all()).results||[];
 const low=q.toLowerCase();
 if(/text|message|tell everyone|remind everyone|send/.test(low)){
   const enrolled=roster.filter(x=>String(x.sms_status).toLowerCase()==='enrolled').length;
   return json({success:true,type:'text_preview',answer:'I can prepare that team text. I will never send it without a coach confirming first.',draft:cleanDraft(q),recipients:enrolled});
 }
 if(/not enrolled|hasn.?t enrolled|who.*enrolled/.test(low)){
   const names=roster.filter(x=>String(x.sms_status).toLowerCase()!=='enrolled').map(x=>x.player_name);
   return json({success:true,type:'answer',answer:names.length?names.join(', ')+' are not enrolled in team texts yet.':'Everyone on the roster is enrolled in team texts.'});
 }
 const person=roster.find(x=>low.includes(x.player_name.toLowerCase())||x.parent_name&&low.includes(x.parent_name.toLowerCase()));
 if(person)return json({success:true,type:'answer',answer:person.player_name+': parent/guardian '+(person.parent_name||'not provided')+', phone '+(person.phone||'not provided')+', jersey '+(person.jersey||'not provided')+', team texts '+person.sms_status+'.'});
 if(/schedule|when|game|play/.test(low)){
   const team=SCHEDULE.find(x=>low.includes(x.opponent.toLowerCase())||low.includes(x.coach.toLowerCase()));
   const list=team?[team]:SCHEDULE;
   return json({success:true,type:'answer',answer:list.map(x=>x.date+' · '+x.time+' vs '+x.opponent+' ('+x.coach+')').join('\n')});
 }
 if(/upload|document|pdf|roster/.test(low))return json({success:true,type:'answer',answer:'Use Upload PDF / Image under Documents & Schedule. The file goes to Needs Review and nothing publishes until a coach approves it.'});
 return json({success:true,type:'answer',answer:'I can help with Team D roster contacts, text-enrollment status, the game schedule, documents, and preparing team texts. Try “When do we play Team A?”, “Who is not enrolled?”, or “Text everyone that practice is canceled.”'});
}
function cleanDraft(q){return q.replace(/^(please\s+)?(text|message|tell)\s+(everyone|the team|parents?)\s*(that|:)?\s*/i,'').trim()||q}
async function schema(db){await db.prepare("CREATE TABLE IF NOT EXISTS britt_team_roster(id INTEGER PRIMARY KEY AUTOINCREMENT,grade TEXT NOT NULL,player_name TEXT NOT NULL UNIQUE,parent_name TEXT NOT NULL,phone TEXT NOT NULL,coach_role TEXT,jersey TEXT,sms_status TEXT NOT NULL DEFAULT 'Not enrolled',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run()}
function json(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

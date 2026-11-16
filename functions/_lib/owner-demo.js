import {authenticate} from '../api/admin-dashboard.js';
import {json} from './coach-auth.js';
export const DEMO_CODE='KS-DEMO';
export const roles=['head','assistant','parent'];
export function demoRole(request){
 const header=request.headers.get('X-Pep-Demo');
 const cookie=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)ks_owner_demo=([^;]+)/)?.[1];
 return header||cookie||null;
}
export const demoCookie=role=>`ks_owner_demo=${role||''}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${role?2592000:0}`;
export async function owner(request,env){return env.SPORTS_DB?authenticate(request,env.SPORTS_DB):null;}
export function seed(){
 const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
 return {revision:0,category:'travel',messages:[{id:'demo-welcome',author:'Coach Jeff Roth',body:'Welcome to our demo team! This message only appears in the owner preview.',created_at:new Date().toISOString(),acknowledged:0}],events:[{id:'practice-demo',type:'practice',title:'Demo basketball practice',date,time:'4:00 PM',endTime:'5:00 PM',detail:'Fictional gym',version:1}],family:[{entry_id:'demo-family',team_code:DEMO_CODE,child_name:'Demo Player',created:Date.now()}]};
}
async function state(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS owner_demo_state (id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL)').run();
 await db.prepare('INSERT OR IGNORE INTO owner_demo_state VALUES(?,?,0)').bind('owner',JSON.stringify(seed())).run();
 const row=await db.prepare('SELECT body,revision FROM owner_demo_state WHERE id=?').bind('owner').first();
 return {...JSON.parse(row.body),revision:row.revision};
}
export async function resetDemo(db){await state(db);await db.prepare('UPDATE owner_demo_state SET body=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(seed()),'owner').run();}
export async function demoApi(request,env,role){
 if(!roles.includes(role)||!await owner(request,env))return json({error:'Sign in to the owner console to use demo mode.'},401);
 const path=new URL(request.url).pathname;
 const coach={id:'owner-demo-'+role,name:'Jeff Roth',email:'coach@example.invalid',phone:'',organization:'Kanab Sports Demo',team_name:'Demo Girls Basketball',team:'Demo Girls Basketball',sport:'Basketball',role:role==='assistant'?'Assistant Coach':'Head Coach',team_code:DEMO_CODE,teamCode:DEMO_CODE,canManageAssistants:role==='head'};
 const isCoach=role!=='parent';
 const unavailable=()=>json({success:false,error:'Demo mode: this action is disabled. No real messages, notifications, uploads, or account changes are sent.'},403);
 const s=await state(env.SPORTS_DB);
 if(request.method==='GET'){
  if(path==='/api/coach-account')return json({authenticated:isCoach,coach:isCoach?coach:null});
  if(path==='/api/coach-profile')return json({signedIn:isCoach,coach:isCoach?coach:null});
  if(path==='/api/parent-account')return json({signedIn:!isCoach,account:!isCoach?{name:'Jeff Roth (Demo Parent)',email:'parent@example.invalid'}:null,family:!isCoach?s.family:[]});
  if(path==='/api/coach-messages'&&isCoach)return json({success:true,teamCode:DEMO_CODE,team:coach.team,sport:coach.sport,category:s.category,approvedCategory:s.category,categoryRevision:s.revision,gate:{allowed:true},eligibleGuardians:1,messages:s.messages,inviteUrl:new URL('/join/'+DEMO_CODE,request.url).href});
  if(path==='/api/coach-events'&&isCoach)return json({success:true,team:coach.team,events:s.events});
  if(path==='/api/coach-schedule'&&isCoach)return json({success:true,coach:{team:coach.team},games:[],source:'Demo team'});
  if(path==='/api/coach-score-approvals'&&isCoach)return json({success:true,approvals:[]});
  if(path==='/api/assistant-coaches'&&role==='head')return json({success:true,team:coach.team,sport:coach.sport,invites:[]});
  if(path==='/api/team-connection'&&role==='parent'&&new URL(request.url).searchParams.get('code')===DEMO_CODE)return json({success:true,team:{code:DEMO_CODE,id:'owner-demo',category:'rec',name:coach.team,sport:coach.sport,color:'#e32636',url:'/family/',coach:[{name:'Jeff Roth',role:'Head Coach'}],events:s.events,messages:s.messages.map(m=>({...m,created:Date.parse(m.created_at),date:m.created_at.slice(0,10)}))}});
  if(path==='/api/family-sharing'&&role==='parent')return json({sender_email:'parent@example.invalid',grants:[],invites:[],schedules:[],teams:[DEMO_CODE]});
  if(path==='/api/family-drivers'&&role==='parent')return json({plans:[]});
  if(path==='/api/athlete-controls'&&role==='parent')return json({enrollments:[]});
  if(path==='/api/school-parent-notices'&&role==='parent')return json({notices:[],preferences:[]});
  if(path==='/api/coach-help')return json({messages:[],peers:[],updates:[],canInvite:false,included:false});
  return unavailable();
 }
 if(request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin)return unavailable();
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return unavailable();
 const raw=await request.text();if(raw.length>12000)return json({error:'Demo request too large.'},413);
 let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
 if(path==='/api/coach-messages'&&isCoach&&b.action==='post'){
  const body=String(b.body||'').trim().slice(0,1200);if(!body)return json({error:'Write a message first.'},400);
  s.messages.unshift({id:crypto.randomUUID(),author:coach.role+' '+coach.name,body,created_at:new Date().toISOString(),acknowledged:0});s.messages=s.messages.slice(0,50);
 }else if(path==='/api/coach-messages'&&role==='head'&&b.action==='set_category'&&['rec','school','travel'].includes(b.kind)){
  if(b.revision!==s.revision)return json({error:'Reload the demo team before changing its type.'},409);s.category=b.kind;
 }else if(path==='/api/coach-events'&&isCoach){
  if(!/^practice-[\w-]{1,80}$/.test(b.event_id||'')||!/^\d{4}-\d{2}-\d{2}$/.test(b.date||'')||!b.title)return json({error:'Enter a practice title and date.'},400);
  const old=s.events.find(e=>e.id===b.event_id);if((old?.version||0)!==b.version)return json({error:'Reload the practice before saving.'},409);
  const event={id:b.event_id,type:'practice',version:(old?.version||0)+1,cancelled:!!b.cancelled};
  for(const key of ['title','date','time','endTime','detail'])event[key]=String(b[key]||'').slice(0,240);
  s.events=[...s.events.filter(e=>e.id!==event.id),event].slice(-50);
  s.messages.unshift({id:crypto.randomUUID(),author:'Coach Jeff Roth',body:'Demo practice updated: '+event.title,created_at:new Date().toISOString(),acknowledged:0});s.messages=s.messages.slice(0,50);
 }else if(path==='/api/parent-account'&&role==='parent'&&b.action==='save_family'){
  s.family=(Array.isArray(b.entries)?b.entries:[]).filter(e=>e.team_code===DEMO_CODE).slice(0,10).map(e=>({entry_id:String(e.entry_id).slice(0,100),team_code:DEMO_CODE,child_name:String(e.child_name||'').slice(0,80),created:Number(e.created)||Date.now()}));
 }else if(path==='/api/family-message-receipts'&&role==='parent'&&b.team_code===DEMO_CODE){
  const m=s.messages.find(m=>m.id===b.message_id);if(m)m.acknowledged=1;
 }else return unavailable();
 const saved=await env.SPORTS_DB.prepare('UPDATE owner_demo_state SET body=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision').bind(JSON.stringify(s),'owner',s.revision).first();
 return saved?json({success:true,message:'Saved to the demo team only. No notifications sent.',revision:saved.revision}):json({error:'Demo changed in another tab. Reload and try again.'},409);
}
export function decorateDemo(html,role){
 const boot=`<script src="/assets/owner-demo.js" data-role="${role}"></script>`;
 return html.replace(/<head[^>]*>/i,match=>match+boot); // executes before portal scripts
}

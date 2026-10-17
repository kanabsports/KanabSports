import {teamEvents} from '../_lib/team-events.js';
import {pilotSchema} from '../_lib/pilot-schema.js';
import {sha256} from '../_lib/coach-auth.js';
import {teamPolicy} from '../_lib/school-access.js';
import {accessSchema,parentSession,hasMembership} from '../_lib/parent-access.js';
import {ensureCoachCore,clean,json} from '../_lib/coach-auth.js';

export async function onRequestGet(context){const response=await loadTeam(context);if(response.ok){try{const db=context.env.SPORTS_DB,code=new URL(context.request.url).searchParams.get('code')?.toUpperCase(),policy=await teamPolicy(db,code),parent=await parentSession(context.request,db);if(parent&&['rec','travel'].includes(policy?.kind)){await pilotSchema(db);await db.prepare('INSERT OR IGNORE INTO pep_family_activity VALUES(?,?,?)').bind(code,await sha256(parent.email),new Date().toLocaleDateString('en-CA',{timeZone:'America/Denver'})).run()}}catch{ /* Measurement must not interrupt family access. */ }}return response}
// Internal principal is supplied only after calendar/driver token verification.
export async function loadTeam({request,env},principal=null){
  if(!env.SPORTS_DB)return json({success:false,error:'Team connection is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await teamSchema(db);await accessSchema(db);
    const code=clean(new URL(request.url).searchParams.get('code'),40).toUpperCase();
    if(!/^[A-Z0-9_-]{1,32}$/.test(code))return json({success:false,error:'Invalid team code.'},400);

    const coaches=(await db.prepare(`
      SELECT id,name,role,organization,team_name,sport,team_url,team_code
      FROM coach_access_requests
      WHERE status='approved' AND team_code=?
      ORDER BY CASE role WHEN 'Head Coach' THEN 1 WHEN 'Coach' THEN 2 ELSE 3 END, reviewed_at DESC
    `).bind(code).all()).results||[];
    if(!coaches.length)return json({success:false,error:'That team code is not active.'},404);

    const primary=coaches[0],team=primary.team_name||primary.organization||primary.sport;
    const policy=await teamPolicy(db,code);const category=policy?.kind==='school'?'school':'rec';

    const parent=principal||await parentSession(request,db);
    if(!await hasMembership(db,parent?.email,code))return json({success:false,code:'GUARDIAN_APPROVAL_REQUIRED',error:parent?`Your ${category==='school'?'school':'team administrator'} must approve your guardian access before you can view private team information.`:`Sign in to My Family, then request ${category==='school'?'school':'team'} approval for guardian access.`},parent?403:401);

    const events=await teamEvents(db,code);
    const messages=(await db.prepare(`
      SELECT id,author,body,created_at
      FROM coach_team_messages
      WHERE team_code=?
      ORDER BY datetime(created_at) DESC
      LIMIT 50
    `).bind(code).all()).results||[];

    await pilotSchema(db);const receipts=(await db.prepare('SELECT message_id FROM pep_message_receipts WHERE email=? AND team_code=?').bind(parent.email,code).all()).results||[];const acknowledged=new Set(receipts.map(x=>x.message_id));
    return json({
      success:true,
      team:{
        code,
        category,
        id:slug(team),
        name:team,
        sport:primary.sport,
        coach:coaches.map(c=>({name:c.name,role:c.role})),
        color:'#e32636',
        url:'/',
        messages:messages.map(m=>({id:m.id,author:m.author,body:m.body,created:Date.parse(m.created_at.replace(' ','T')+'Z'),acknowledged:acknowledged.has(m.id),date:formatDate(m.created_at)})),
        events
      }
    });
  }catch(error){
    console.error('team connection error',error);
    return json({success:false,error:'Could not load that team.'},500);
  }
}

export async function teamSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_team_messages(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,team_code TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_schedule_games(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,date TEXT NOT NULL,opponent TEXT NOT NULL,time TEXT,site TEXT,result TEXT,source_document_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_documents(
    id TEXT PRIMARY KEY,verification_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,document_type TEXT NOT NULL,season TEXT NOT NULL,notes TEXT,filename TEXT NOT NULL,byte_size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER NOT NULL DEFAULT 0,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
function slug(v){return String(v||'team').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'team'}
function formatDate(v){try{return new Date(v+'Z').toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch{return String(v||'')}}
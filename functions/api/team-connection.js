import {ensureCoachCore,clean,json} from '../_lib/coach-auth.js';

export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Team connection is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
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
    const category=/^KHS$/i.test(primary.organization)||/kanab high school/i.test(primary.organization)?'school':'rec';

    const latest=await db.prepare(`
      SELECT g.source_document_id
      FROM coach_schedule_games g
      JOIN coach_documents d ON d.id=g.source_document_id
      JOIN coach_access_requests c ON c.id=g.coach_id
      WHERE c.team_code=? AND d.status='approved'
      ORDER BY datetime(COALESCE(d.reviewed_at,d.created_at)) DESC
      LIMIT 1
    `).bind(code).first();

    let events=[];
    if(latest?.source_document_id){
      const rows=(await db.prepare(`
        SELECT g.id,g.date,g.opponent,g.time,g.site
        FROM coach_schedule_games g
        JOIN coach_access_requests c ON c.id=g.coach_id
        WHERE c.team_code=? AND g.source_document_id=?
        ORDER BY g.date
      `).bind(code,latest.source_document_id).all()).results||[];
      events=rows.map(r=>({
        id:r.id,date:r.date,endDate:r.date,time:r.time||'TBA',
        title:'Game vs '+r.opponent,detail:[r.site,r.opponent].filter(Boolean).join(' · '),
        type:'game',url:'/'
      }));
    }

    const messages=(await db.prepare(`
      SELECT id,author,body,created_at
      FROM coach_team_messages
      WHERE team_code=?
      ORDER BY datetime(created_at) DESC
      LIMIT 50
    `).bind(code).all()).results||[];

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
        messages:messages.map(m=>({id:m.id,author:m.author,body:m.body,created:m.created_at,date:formatDate(m.created_at)})),
        events
      }
    });
  }catch(error){
    console.error('team connection error',error);
    return json({success:false,error:'Could not load that team.'},500);
  }
}

async function schema(db){
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
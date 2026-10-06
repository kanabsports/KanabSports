import {getCoach,ensureCoachCore,json} from '../_lib/coach-auth.js';

export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Coach schedule is temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your coach account first.'},401);

    let games=await storedGames(db,coach.id);
    let source='saved schedule';

    if(!games.length){
      games=await structuredDocumentGames(db,coach.id);
      source=games.length?'approved uploaded schedule':'';
    }

    if(!games.length){
      games=await scheduleSubmissionGames(db,coach);
      source=games.length?'approved schedule update':'';
    }

    const scores=await approvedScores(db,coach);
    games=games.map(g=>{
      const score=scores.find(s=>sameDate(s.date,g.date)&&sameOpponent(s.opponent,g.opponent));
      return {...g,result:score?.result||g.result||'',scoreId:score?.id||null,status:score?'live':'open'};
    });

    games.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    return json({
      success:true,
      coach:{name:coach.name,team:coach.team_name||coach.organization,sport:coach.sport},
      source,
      games
    });
  }catch(error){
    console.error('coach schedule error',error);
    return json({success:false,error:'Could not load the team schedule.'},500);
  }
}

async function storedGames(db,coachId){
  return (await db.prepare(`SELECT id,date,opponent,time,site,result FROM coach_schedule_games WHERE coach_id=? ORDER BY date`).bind(coachId).all()).results||[];
}

async function structuredDocumentGames(db,coachId){
  try{
    const rows=(await db.prepare(`
      SELECT d.payload_json
      FROM dev_documents d
      JOIN coach_documents c ON c.id=d.document_id
      WHERE c.verification_id=? AND c.status='approved'
      ORDER BY d.updated_at DESC
      LIMIT 3
    `).bind(coachId).all()).results||[];
    const out=[];
    for(const row of rows){
      try{
        const payload=JSON.parse(row.payload_json||'{}');
        for(const g of payload.schedule||[]){
          const date=normalizeDate(g.date,payload.season);
          const opponent=cleanOpponent(g.opponent);
          if(date&&opponent)out.push({id:'doc-'+out.length,date,opponent,time:String(g.time||''),site:String(g.site||''),result:String(g.result||'')});
        }
      }catch{}
    }
    return unique(out);
  }catch{return []}
}

async function scheduleSubmissionGames(db,coach){
  try{
    const rows=(await db.prepare(`
      SELECT message,event_date,opponent,result
      FROM coach_submissions
      WHERE status='approved' AND type='Schedule'
        AND (lower(email)=lower(?) OR (lower(team)=lower(?) AND lower(sport)=lower(?)))
      ORDER BY COALESCE(published_at,reviewed_at,created_at) DESC
      LIMIT 5
    `).bind(coach.email,coach.team_name||coach.organization,coach.sport).all()).results||[];
    const out=[];
    for(const row of rows){
      if(row.event_date&&row.opponent)out.push({id:'sub-'+out.length,date:row.event_date,opponent:row.opponent,time:'',site:'',result:row.result||''});
      out.push(...parseScheduleText(row.message||''));
    }
    return unique(out);
  }catch{return []}
}

async function approvedScores(db,coach){
  try{
    const rows=(await db.prepare(`
      SELECT id,event_date AS date,opponent,result
      FROM coach_submissions
      WHERE status='approved' AND type='Score'
        AND lower(team)=lower(?) AND lower(sport)=lower(?)
      ORDER BY COALESCE(published_at,reviewed_at,created_at) DESC
      LIMIT 100
    `).bind(coach.team_name||coach.organization,coach.sport).all()).results||[];
    return rows;
  }catch{return []}
}

function parseScheduleText(text){
  const out=[];
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.replace(/\s+/g,' ').trim();
    if(!line)continue;
    const iso=line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    const md=line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
    let date='';
    if(iso)date=`${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
    else if(md){
      let y=md[3]?Number(md[3]):new Date().getFullYear();
      if(y<100)y+=2000;
      date=`${y}-${pad(md[1])}-${pad(md[2])}`;
    }
    if(!date)continue;
    let rest=line.replace(iso?.[0]||md?.[0]||'',' ').replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/ig,' ').replace(/\b(?:vs\.?|at|@)\b/i,' ').replace(/[|•·–—-]+/g,' ').replace(/\s+/g,' ').trim();
    rest=rest.replace(/\b(home|away)\b/ig,' ').replace(/\s+/g,' ').trim();
    if(rest.length>=2)out.push({id:'text-'+out.length,date,opponent:cleanOpponent(rest),time:'',site:'',result:''});
  }
  return out;
}

function normalizeDate(value,season){
  const v=String(value||'').trim();
  if(/^20\d{2}-\d{2}-\d{2}$/.test(v))return v;
  const m=v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?$/);
  if(m){
    let year=m[3]?Number(m[3]):seasonYear(season);
    if(year<100)year+=2000;
    return `${year}-${pad(m[1])}-${pad(m[2])}`;
  }
  const d=new Date(v);
  if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10);
  return '';
}
function seasonYear(season){const m=String(season||'').match(/20\d{2}/);return m?Number(m[0]):new Date().getFullYear()}
function cleanOpponent(v){return String(v||'').replace(/^vs\.?\s*/i,'').replace(/^@\s*/,'').trim()}
function unique(rows){const seen=new Set();return rows.filter(g=>{const k=g.date+'|'+norm(g.opponent);if(!g.date||!g.opponent||seen.has(k))return false;seen.add(k);return true})}
function sameDate(a,b){return String(a||'').slice(0,10)===String(b||'').slice(0,10)}
function sameOpponent(a,b){return norm(a)===norm(b)}
function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function pad(v){return String(v).padStart(2,'0')}
async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_schedule_games(
    id TEXT PRIMARY KEY,coach_id TEXT NOT NULL,date TEXT NOT NULL,opponent TEXT NOT NULL,time TEXT,site TEXT,result TEXT,
    source_document_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
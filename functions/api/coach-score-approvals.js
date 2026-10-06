import {getCoach,ensureCoachCore,sameOrigin,clean,json} from '../_lib/coach-auth.js';

export async function onRequest({request,env}){
  if(!env.SPORTS_DB)return json({success:false,error:'Score approvals are temporarily unavailable.'},503);
  const db=env.SPORTS_DB;
  try{
    await ensureCoachCore(db);await schema(db);
    const coach=await getCoach(request,db);
    if(!coach)return json({success:false,error:'Sign in with your coach account first.'},401);

    if(request.method==='GET'){
      const rows=(await db.prepare(`
        SELECT id,team,sport,event_date AS date,opponent,result,assistant_name,created_at
        FROM coach_submissions
        WHERE source='Score Assistant' AND status='pending' AND accountable_coach_id=?
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).bind(coach.id).all()).results||[];
      return json({success:true,approvals:rows});
    }

    if(request.method!=='POST')return json({success:false,error:'Method not allowed.'},405);
    if(!sameOrigin(request))return json({success:false,error:'Open Kanab Sports to review scores.'},403);

    const body=await request.json(),id=clean(body.id,80),action=clean(body.action,20);
    if(!id||!['approve','reject'].includes(action))return json({success:false,error:'Choose a pending score and action.'},400);
    const row=await db.prepare(`
      SELECT id,status,team,opponent,result
      FROM coach_submissions
      WHERE id=? AND source='Score Assistant' AND accountable_coach_id=?
      LIMIT 1
    `).bind(id,coach.id).first();
    if(!row)return json({success:false,error:'That score approval was not found.'},404);
    if(row.status!=='pending')return json({success:false,error:`That score has already been ${row.status}.`},409);
    const now=new Date().toISOString();
    if(action==='approve'){
      await db.prepare(`
        UPDATE coach_submissions
        SET status='approved',reviewed_at=?,published_at=?,coach_approved_at=?,review_token_hash=NULL
        WHERE id=? AND status='pending'
      `).bind(now,now,now,id).run();
      return json({success:true,message:`Published: ${row.team} ${row.result} vs ${row.opponent}.`});
    }
    await db.prepare(`
      UPDATE coach_submissions
      SET status='rejected',reviewed_at=?,review_token_hash=NULL
      WHERE id=? AND status='pending'
    `).bind(now,id).run();
    return json({success:true,message:'Score denied. Nothing was published.'});
  }catch(error){
    console.error('coach score approvals error',error);
    return json({success:false,error:'Could not finish the score review.'},500);
  }
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_submissions (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,type TEXT NOT NULL,name TEXT,email TEXT,team TEXT,sport TEXT,event_date TEXT,opponent TEXT,result TEXT,link TEXT,message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for(const q of [
    `ALTER TABLE coach_submissions ADD COLUMN accountable_coach_id TEXT`,
    `ALTER TABLE coach_submissions ADD COLUMN accountable_coach_name TEXT`,
    `ALTER TABLE coach_submissions ADD COLUMN assistant_name TEXT`,
    `ALTER TABLE coach_submissions ADD COLUMN coach_approved_at TEXT`
  ])try{await db.prepare(q).run()}catch{}
}
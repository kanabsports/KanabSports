import {kanabDate} from '../../assets/event-dates.mjs';
export async function onRequestGet({env}){
  if(!env.SPORTS_DB)return json({announcements:[]});
  try{
    await schema(env.SPORTS_DB);
    const rows=await env.SPORTS_DB.prepare(`SELECT id,title,detail,sport,event_date,end_date,href,featured,published_at FROM site_announcements WHERE status='approved' AND (COALESCE(NULLIF(end_date,''),NULLIF(event_date,'')) IS NULL OR date(COALESCE(NULLIF(end_date,''),event_date))>=?) ORDER BY featured DESC,date(event_date),published_at DESC LIMIT 30`).bind(kanabDate()).all();
    return json({announcements:(rows.results||[]).map(row=>({id:row.id,title:row.title,detail:row.detail,sport:row.sport,date:row.event_date,end:row.end_date,href:row.href||'#registration',type:'Kanab Recreation',featured:Boolean(row.featured),publishedAt:row.published_at}))},{'Cache-Control':'no-store'});
  }catch(error){console.error('announcement read error',error);return json({announcements:[]});}
}

async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS site_announcements (id TEXT PRIMARY KEY,source TEXT NOT NULL,sender_email TEXT NOT NULL,message_id TEXT UNIQUE,original_subject TEXT,original_body TEXT,title TEXT NOT NULL,detail TEXT NOT NULL,sport TEXT,event_date TEXT,end_date TEXT,href TEXT,featured INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,removed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
function json(data,headers={}){return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8',...headers}})}

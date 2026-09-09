export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({teams:[]},200);
  try{
    await ensureSchema(env.SPORTS_DB);
    const rows=await env.SPORTS_DB.prepare(`SELECT id,name,email,team,sport,document_type,season,notes,filename,byte_size,reviewed_at,created_at FROM coach_documents WHERE status='approved' ORDER BY COALESCE(reviewed_at,created_at) DESC`).all();
    const map=new Map();
    for(const r of rows.results||[]){
      const key=slug(r.sport)+'|'+slug(r.team);if(map.has(key))continue;
      const notes=String(r.notes||''),schedule=matchUrl(notes,'MaxPreps schedule:'),roster=matchUrl(notes,'MaxPreps roster:');
      map.set(key,{id:r.id,key:slug(r.sport),teamKey:slug(r.team),name:r.team||r.sport,team:r.team||'',sport:r.sport||'',season:r.season||'',documentType:r.document_type||'',notes:stripSourceLines(notes),scheduleUrl:schedule,rosterUrl:roster,hasPdf:Number(r.byte_size||0)>0,updatedAt:r.reviewed_at||r.created_at||null});
    }
    return json({teams:[...map.values()]});
  }catch(error){console.error('public teams error',error);return json({teams:[]},200)}
}
async function ensureSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS coach_documents (id TEXT PRIMARY KEY,verification_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,document_type TEXT NOT NULL,season TEXT NOT NULL,notes TEXT,filename TEXT NOT NULL,byte_size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER NOT NULL DEFAULT 0,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
function matchUrl(notes,label){const line=notes.split(/\r?\n/).find(x=>x.startsWith(label));return line?line.slice(label.length).trim():''}
function stripSourceLines(notes){return notes.split(/\r?\n/).filter(x=>!x.startsWith('MaxPreps schedule:')&&!x.startsWith('MaxPreps roster:')).join('\n').trim()}
function slug(v){return String(v||'team').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'team'}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
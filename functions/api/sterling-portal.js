const OWNER='howdy@kanabsports.com';

export async function onRequestPost({request,env}){
  if(!env.SPORTS_DB||!env.RESEND_API_KEY)return json({success:false,error:'The contributor service is unavailable.'},503);
  try{
    if(!await authenticate(request,env.SPORTS_DB))return json({success:false,error:'Your 24-hour session has expired.'},401);
    const form=await request.formData();
    if(clean(form.get('website'),100))return json({success:true,message:'Received.'});
    const section=clean(form.get('section'),40),requestType=clean(form.get('request_type'),40),headline=clean(form.get('headline'),140),
      eventDate=date(form.get('event_date')),endDate=date(form.get('end_date'))||eventDate,details=clean(form.get('details'),6000),
      publishNow=String(form.get('publish_now')||'')==='yes',file=form.get('file');
    const allowedSections=['ticker','happening','registration','community','places','rec','reference'];
    const allowedTypes=['quick','calendar','registration','facility','community','private'];
    if(!allowedSections.includes(section)||!allowedTypes.includes(requestType)||!headline||!details)return json({success:false,error:'Add a title and explain what changed.'},400);
    if(publishNow&&requestType==='quick'&&!eventDate)return json({success:false,error:'Add the date for this update.'},400);

    let attachment=null,filename='',byteSize=0;
    if(file&&typeof file.arrayBuffer==='function'&&file.size){
      if(file.size>4*1024*1024)return json({success:false,error:'Please keep the file under 4 MB.'},413);
      if(!['application/pdf','image/png','image/jpeg'].includes(file.type))return json({success:false,error:'Upload a PDF, PNG or JPG.'},400);
      const bytes=new Uint8Array(await file.arrayBuffer());
      filename=safeFilename(file.name);byteSize=bytes.byteLength;attachment={filename,content:toBase64(bytes)};
    }

    await schema(env.SPORTS_DB);
    const id=crypto.randomUUID(),canPublish=publishNow&&requestType!=='private',status=canPublish?'approved':'pending';
    await env.SPORTS_DB.prepare(`INSERT INTO sterling_submissions (id,section,request_type,headline,event_date,end_date,time_text,location,details,filename,byte_size,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
      .bind(id,section,requestType,headline,eventDate,endDate,'','',details,filename,byteSize,status).run();

    let resultWord='sent privately';
    let publicHref='';
    if(canPublish&&requestType==='calendar'){
      await calendarSchema(env.SPORTS_DB);
      const slug=slugify(headline),existing=await env.SPORTS_DB.prepare(`SELECT id FROM rec_calendars WHERE slug=? LIMIT 1`).bind(slug).first();
      await env.SPORTS_DB.prepare(`INSERT INTO rec_calendars (id,slug,title,details,source_filename,status,created_at,updated_at) VALUES (?,?,?,?,?,'approved',datetime('now'),datetime('now')) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,details=excluded.details,source_filename=excluded.source_filename,status='approved',updated_at=datetime('now')`)
        .bind(existing?.id||crypto.randomUUID(),slug,headline,details,filename).run();
      publicHref=`/calendar.html?slug=${encodeURIComponent(slug)}`;
      await publishAnnouncement(env.SPORTS_DB,id,headline,`Recreation calendar · ${summary(details)}`,eventDate,endDate,publicHref,'Rec Sports');
      resultWord=existing?'updated':'created';
    }else if(canPublish){
      publicHref=section==='registration'?'#rec':section==='places'||section==='community'?'#community':'#registration';
      const detail=[eventDate?formatDate(eventDate):'',details].filter(Boolean).join(' · ');
      await publishAnnouncement(env.SPORTS_DB,id,headline,detail,eventDate,endDate,publicHref,'');
      resultWord='published';
    }

    const sectionLabel=labels[section]||section,subject=`${canPublish?'Published':'Private Sterling file'} — ${headline}`;
    const text=`Sterling contributor page\n\nSection: ${sectionLabel}\nType: ${requestType}\nTitle: ${headline}\nDate: ${eventDate||'Not provided'}\nRemove after: ${endDate||'Not provided'}\nFile: ${filename||'None'}\nStatus: ${canPublish?resultWord:'Private only'}\n\n${details}`;
    const html=`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:660px"><div style="font-size:12px;font-weight:900;color:#b71927;text-transform:uppercase">Kanab Sports · Sterling contributor</div><h1 style="font-size:28px">${esc(headline)}</h1><table style="border-collapse:collapse;margin:20px 0">${[['Section',sectionLabel],['Type',requestType],['Date',eventDate||'Not provided'],['Remove after',endDate||'Not provided'],['File',filename||'None'],['Status',canPublish?resultWord:'Private only']].map(([a,b])=>`<tr><td style="padding:6px 18px 6px 0;font-weight:800;vertical-align:top">${esc(a)}</td><td style="padding:6px 0">${esc(b)}</td></tr>`).join('')}</table><div style="background:#f4f4f2;border-radius:10px;padding:16px;white-space:pre-wrap">${esc(details)}</div>${publicHref?`<p style="margin-top:20px"><a href="https://kanabsports.com${publicHref}" style="display:inline-block;background:#e32636;color:#fff;padding:13px 18px;border-radius:8px;text-decoration:none;font-weight:800">View published update</a></p>`:'<p style="margin-top:20px;color:#666">This file remains private.</p>'}</div>`;
    const payload={from:'Kanab Sports <website@kanabsports.com>',to:[OWNER],subject,text,html};
    if(attachment)payload.attachments=[attachment];
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`sterling-portal-${id}`},body:JSON.stringify(payload)});
    if(!sent.ok&&!canPublish)return json({success:false,error:'The private file could not be delivered. Please try again.'},502);
    if(canPublish)return json({success:true,message:`${requestType==='calendar'?(resultWord==='created'?'Calendar created and published.':'Calendar updated and published.'):'Update published.'}${sent.ok?' You were notified by email.':' The notification email was delayed.'}`,href:publicHref});
    return json({success:true,message:'Sent privately to Kanab Sports.'});
  }catch(error){console.error('sterling portal error',error);return json({success:false,error:'The update could not be sent.'},500)}
}

async function publishAnnouncement(db,id,title,detail,eventDate,endDate,href,sport){
  await announcementSchema(db);
  if(sport==='Rec Sports'){
    const existing=await db.prepare(`SELECT id FROM site_announcements WHERE source='sterling_portal' AND href=? AND status='approved' LIMIT 1`).bind(href).first();
    if(existing){
      await db.prepare(`UPDATE site_announcements SET original_subject=?,original_body=?,title=?,detail=?,sport=?,event_date=?,end_date=?,published_at=datetime('now'),removed_at=NULL WHERE id=?`).bind(title,detail,title,detail,sport,eventDate,endDate,existing.id).run();
      return;
    }
  }
  await db.prepare(`INSERT INTO site_announcements (id,source,sender_email,message_id,original_subject,original_body,title,detail,sport,event_date,end_date,href,featured,status,published_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'approved',datetime('now'),datetime('now'))`)
    .bind(id,'sterling_portal','sglover@kanab.utah.gov',`sterling-portal-${id}`,title,detail,title,detail,sport,eventDate,endDate,href).run();
}
async function authenticate(request,db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS sterling_sessions (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  const cookie=request.headers.get('Cookie')||'',match=cookie.match(/(?:^|;\s*)ks_sterling=([^;]+)/);if(!match)return null;
  const hash=await sha256(decodeURIComponent(match[1]));
  return db.prepare(`SELECT id FROM sterling_sessions WHERE token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1`).bind(hash).first();
}
async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS sterling_submissions (id TEXT PRIMARY KEY,section TEXT NOT NULL,request_type TEXT NOT NULL,headline TEXT NOT NULL,event_date TEXT,end_date TEXT,time_text TEXT,location TEXT,details TEXT NOT NULL,filename TEXT,byte_size INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function calendarSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS rec_calendars (id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,details TEXT NOT NULL,source_filename TEXT,status TEXT NOT NULL DEFAULT 'approved',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function announcementSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS site_announcements (id TEXT PRIMARY KEY,source TEXT NOT NULL,sender_email TEXT NOT NULL,message_id TEXT UNIQUE,original_subject TEXT,original_body TEXT,title TEXT NOT NULL,detail TEXT NOT NULL,sport TEXT,event_date TEXT,end_date TEXT,href TEXT,featured INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,removed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
const labels={ticker:'This Week ticker',happening:'Happening Now',registration:'Registration',community:'Community Play',places:'Places to Play',rec:'Rec Sports',reference:'Private reference'};
function slugify(v){return String(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'recreation-calendar'}
function summary(v){const s=String(v).replace(/\s+/g,' ').trim();return s.length>170?s.slice(0,167)+'…':s}
function date(v){const s=String(v||'').trim();return /^20\d{2}-\d{2}-\d{2}$/.test(s)?s:null}
function formatDate(v){return new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}
function safeFilename(v){const s=String(v||'file').replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\s+/g,' ').trim().slice(0,120);return s||'upload'}
function toBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function clean(v,max=500){return String(v||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

const OWNER='howdy@kanabsports.com';
const TRUSTED_WORK='sglover@kanab.utah.gov';
const TRUSTED_PERSONAL='gloversterling@gmail.com';

export async function onRequestPost({request,env}){
  if(!env.SPORTS_DB||!env.RESEND_API_KEY)return json({ok:false,error:'Update service is not configured.'},503);
  try{
    const raw=await request.text(),url=new URL(request.url),input=JSON.parse(raw);
    let sender='',subject='',body='',messageId='',source='secure webhook';
    const signed=request.headers.get('svix-id')&&env.RESEND_WEBHOOK_SECRET&&await verifyResend(raw,request.headers,env.RESEND_WEBHOOK_SECRET);
    const keyed=await hasWebhookKey(env,url.searchParams.get('key')||'');
    if(input.type==='email.received'){
      if(!signed&&!keyed)return json({ok:false,error:'Invalid webhook signature.'},401);
      const event=input,emailId=clean(event.data?.email_id,100);if(!emailId)return json({ok:false,error:'Email ID missing.'},400);
      const received=await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`}});
      if(!received.ok)return json({ok:false,error:'Unable to retrieve received email.'},502);
      const email=await received.json();sender=address(email.from||event.data?.from);subject=clean(email.subject||event.data?.subject,300);body=clean(email.text||stripHtml(email.html||''),6000);messageId=clean(email.message_id||event.data?.message_id||emailId,300);source='Resend inbound';
    }else{
      const auth=request.headers.get('Authorization')||'';if(!env.REC_UPDATE_WEBHOOK_SECRET||!constantEqual(auth,`Bearer ${env.REC_UPDATE_WEBHOOK_SECRET}`))return json({ok:false,error:'Unauthorized.'},401);
      sender=address(input.sender);subject=clean(input.subject,300);body=clean(input.text||input.body,6000);messageId=clean(input.message_id||input.id||crypto.randomUUID(),300);source='mail automation';
    }
    if(![TRUSTED_WORK,TRUSTED_PERSONAL].includes(sender))return json({ok:true,ignored:true});
    await schema(env.SPORTS_DB);
    const duplicate=await env.SPORTS_DB.prepare(`SELECT id,status FROM site_announcements WHERE message_id=? LIMIT 1`).bind(messageId).first();if(duplicate)return json({ok:true,duplicate:true,id:duplicate.id,status:duplicate.status});
    const parsed=parseUpdate(`${subject}\n${body}`);
    const auto=sender===TRUSTED_WORK&&parsed.confident;
    const id=crypto.randomUUID(),token=randomToken(),tokenHash=await sha256(token),expires=new Date(Date.now()+7*86400000).toISOString(),status=auto?'approved':'pending',published=auto?new Date().toISOString():null;
    await env.SPORTS_DB.prepare(`INSERT INTO site_announcements (id,source,sender_email,message_id,original_subject,original_body,title,detail,sport,event_date,end_date,href,featured,status,review_token_hash,review_expires_at,published_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,datetime('now'))`).bind(id,source,sender,messageId,subject,body,parsed.title,parsed.detail,parsed.sport,parsed.date,parsed.end,parsed.href,status,tokenHash,expires,published).run();
    const origin=new URL(request.url).origin;
    if(auto)await sendOwner(env.RESEND_API_KEY,{subject:`Updated per Sterling — ${parsed.title}`,heading:'Sterling’s update is live',intro:'The site was updated automatically from Sterling’s verified Kanab City email.',parsed,primary:{label:'View on Kanab Sports',url:`${origin}/#registration`},secondary:{label:'Undo this update',url:`${origin}/site-update?token=${encodeURIComponent(token)}&action=undo`}},`sterling-auto-${id}`);
    else await sendOwner(env.RESEND_API_KEY,{subject:`Review Sterling’s update — ${parsed.title}`,heading:parsed.confident?'Sterling’s personal-email update is ready':'Sterling’s message needs a quick review',intro:parsed.confident?'Nothing is live yet. Personal-email requests always wait for your approval.':'The message was saved, but it was not clear enough to publish automatically.',parsed,primary:{label:'Approve & publish',url:`${origin}/site-update?token=${encodeURIComponent(token)}&action=approve`},secondary:{label:'Deny',url:`${origin}/site-update?token=${encodeURIComponent(token)}&action=deny`}},`sterling-review-${id}`);
    return json({ok:true,id,status,confident:parsed.confident});
  }catch(error){console.error('rec email update error',error);return json({ok:false,error:'The email could not be processed.'},500)}
}

export function parseUpdate(input){
  const text=clean(input,6300),lower=text.toLowerCase();
  const sports=['basketball','soccer','baseball','softball','football','volleyball','wrestling','golf','track','cross country','swimming','pickleball','tennis'];
  const sport=sports.find(s=>lower.includes(s))||'';
  const kinds=[['tryout','Tryouts'],['registration','Registration'],['sign-up','Registration'],['signup','Registration'],['game','Game'],['tournament','Tournament'],['practice','Practice'],['clinic','Clinic'],['camp','Camp'],['league','League']];
  const kind=(kinds.find(([needle])=>lower.includes(needle))||[])[1]||'Recreation Update';
  const date=parseDate(text),end=parseEndDate(text,date),time=parseTime(text),location=parseLocation(text,time);
  const title=sport?`${titleCase(sport)} ${kind}`:kind;
  const pieces=[];if(date)pieces.push(formatDate(date));if(time)pieces.push(time);if(location)pieces.push(location);
  const sentence=clean((text.split(/\n+/).map(x=>x.trim()).find(x=>x&&!/^re:|^fw:|^fwd:/i.test(x))||'').replace(/\b(?:please\s+)?put (?:this|it) (?:in|on) (?:the )?ticker\b[.!]?/ig,''),240);
  const detail=pieces.join(' · ')||(sentence||'Details from Kanab City Recreation');
  return{confident:Boolean(sport&&kind!=='Recreation Update'&&date),title,detail,sport:titleCase(sport),date,end,href:'#registration'};
}

function parseDate(text){
  const now=new Date(),yearNow=now.getUTCFullYear(),months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  let m=text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?|september|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?/i);
  let month,day,year;if(m){month=months[m[1].toLowerCase().replace('.','')];day=Number(m[2]);year=Number(m[3]||yearNow)}else{m=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);if(!m)return null;month=Number(m[1]);day=Number(m[2]);year=m[3]?Number(m[3].length===2?'20'+m[3]:m[3]):yearNow}
  if(month<1||month>12||day<1||day>31)return null;let value=iso(year,month,day);if(!value)return null;if(!m[3]&&new Date(value+'T12:00:00Z')<new Date(now.getTime()-30*86400000))value=iso(year+1,month,day);return value;
}
function parseEndDate(text,start){const m=text.match(/\b(?:through|until|thru)\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?|september|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);return m?parseDate(m[1]):start}
function parseTime(text){const m=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);if(!m)return'';return`${Number(m[1])}:${m[2]||'00'} ${m[3].replaceAll('.','').toUpperCase()}`}
function parseLocation(text,time){let search=text;if(time){const idx=search.toLowerCase().indexOf(time.toLowerCase());if(idx>=0)search=search.slice(idx+time.length)}const m=search.match(/\b(?:at|location:?|in)\s+([A-Z][A-Za-z0-9'& .-]{2,60}?)(?=[.,;\n]|$)/);if(!m)return'';const value=clean(m[1],80);return /^(the )?(ticker|site|website)$/i.test(value)?'':value}
function formatDate(value){return new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'})}
function iso(y,m,d){const probe=new Date(Date.UTC(y,m-1,d));if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==m-1||probe.getUTCDate()!==d)return null;return`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function titleCase(v){return String(v||'').replace(/\b\w/g,c=>c.toUpperCase())}
function address(v){const s=String(v||'').trim().toLowerCase(),m=s.match(/<([^>]+)>/);return(m?m[1]:s).trim()}
function stripHtml(v){return String(v).replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ')}
async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS site_announcements (id TEXT PRIMARY KEY,source TEXT NOT NULL,sender_email TEXT NOT NULL,message_id TEXT UNIQUE,original_subject TEXT,original_body TEXT,title TEXT NOT NULL,detail TEXT NOT NULL,sport TEXT,event_date TEXT,end_date TEXT,href TEXT,featured INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,reviewed_at TEXT,published_at TEXT,removed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function hasWebhookKey(env,key){if(!key)return false;if(env.REC_UPDATE_WEBHOOK_SECRET&&constantEqual(key,env.REC_UPDATE_WEBHOOK_SECRET))return true;await env.SPORTS_DB.prepare(`CREATE TABLE IF NOT EXISTS integration_secrets (name TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();const row=await env.SPORTS_DB.prepare(`SELECT secret_hash FROM integration_secrets WHERE name='sterling_inbound' LIMIT 1`).first();return Boolean(row?.secret_hash)&&constantEqual(await sha256(key),row.secret_hash)}
async function sendOwner(apiKey,{subject,heading,intro,parsed,primary,secondary},key){const rows=[['Update',parsed.title],['When',parsed.date?formatDate(parsed.date):'Not confidently identified'],['Details',parsed.detail],['Sender','Sterling Glover']];const text=`${heading}\n\n${intro}\n\n${rows.map(([a,b])=>`${a}: ${b}`).join('\n')}\n\n${primary.label}: ${primary.url}\n${secondary.label}: ${secondary.url}`;const html=`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px"><div style="font-size:12px;font-weight:900;color:#b71927;text-transform:uppercase">Kanab Sports</div><h1 style="font-size:28px;line-height:1.1">${esc(heading)}</h1><p>${esc(intro)}</p><table style="border-collapse:collapse;margin:20px 0">${rows.map(([a,b])=>`<tr><td style="padding:7px 18px 7px 0;font-weight:800;vertical-align:top">${esc(a)}</td><td style="padding:7px 0">${esc(b)}</td></tr>`).join('')}</table><a href="${esc(primary.url)}" style="display:block;background:#16833a;color:#fff;text-align:center;text-decoration:none;font-size:20px;font-weight:900;padding:19px 24px;border-radius:10px">${esc(primary.label)}</a><div style="text-align:center;margin-top:28px"><a href="${esc(secondary.url)}" style="color:#8f1f27;font-size:13px;font-weight:800">${esc(secondary.label)}</a></div></div>`;const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[OWNER],subject,text,html})});if(!r.ok)console.error('owner update email failed',r.status)}
async function verifyResend(payload,headers,secret){try{const id=headers.get('svix-id'),ts=headers.get('svix-timestamp'),sig=headers.get('svix-signature');if(!id||!ts||!sig||Math.abs(Date.now()/1000-Number(ts))>300)return false;const key=Uint8Array.from(atob(secret.replace(/^whsec_/,'')),c=>c.charCodeAt(0)),cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),mac=await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(`${id}.${ts}.${payload}`)),expected=btoa(String.fromCharCode(...new Uint8Array(mac)));return sig.split(' ').some(part=>part.startsWith('v1,')&&constantEqual(part.slice(3),expected))}catch{return false}}
function constantEqual(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0}
function randomToken(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function clean(v,max=500){return String(v||'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function esc(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

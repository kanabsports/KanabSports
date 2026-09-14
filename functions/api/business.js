const OWNER_EMAIL='howdy@kanabsports.com';

export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({error:'Database unavailable.'},503);
  const session=await authenticate(request,env.SPORTS_DB);if(!session)return json({error:'Unauthorized.'},401);
  await schema(env.SPORTS_DB);await seedStartingLedger(env.SPORTS_DB);
  const [transactions,sponsors,mileage]=await Promise.all([
    env.SPORTS_DB.prepare(`SELECT id,type,date,amount,category,vendor,description,source,created_at FROM business_transactions ORDER BY date DESC,created_at DESC LIMIT 500`).all(),
    env.SPORTS_DB.prepare(`SELECT id,name,contact_email,amount,frequency,status,next_due,notes,created_at,updated_at FROM business_sponsors ORDER BY name`).all(),
    env.SPORTS_DB.prepare(`SELECT id,date,starting_point,destination,purpose,miles,notes,created_at FROM business_mileage ORDER BY date DESC,created_at DESC LIMIT 500`).all()
  ]);
  return json({transactions:transactions.results||[],sponsors:sponsors.results||[],mileage:mileage.results||[]});
}

export async function onRequestPost({request,env}){
  if(!env.SPORTS_DB)return json({error:'Database unavailable.'},503);
  const session=await authenticate(request,env.SPORTS_DB);if(!session)return json({error:'Unauthorized.'},401);
  await schema(env.SPORTS_DB);await seedStartingLedger(env.SPORTS_DB);
  try{
    const body=await request.json(),action=clean(body.action,30),type=clean(body.type,30);
    if(action!=='add')return json({error:'Unsupported action.'},400);
    if(type==='expense'||type==='income'){
      const amount=number(body.amount);if(amount<0)return json({error:'Amount must be zero or greater.'},400);
      const id=crypto.randomUUID(),date=cleanDate(body.date),category=clean(body.category,120),vendor=clean(body.vendor,160),description=clean(body.description,300);
      if(!date)return json({error:'Date is required.'},400);
      await env.SPORTS_DB.prepare(`INSERT INTO business_transactions (id,type,date,amount,category,vendor,description,source,created_at) VALUES (?,?,?,?,?,?,?,'manual',datetime('now'))`).bind(id,type,date,amount,category,vendor,description).run();
      return json({success:true,id});
    }
    if(type==='mileage'){
      const id=crypto.randomUUID(),date=cleanDate(body.date),miles=number(body.miles),purpose=clean(body.purpose||body.description,240);
      if(!date||miles<=0)return json({error:'Date and miles are required.'},400);
      await env.SPORTS_DB.prepare(`INSERT INTO business_mileage (id,date,starting_point,destination,purpose,miles,notes,created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))`).bind(id,date,clean(body.starting_point,160),clean(body.destination,160),purpose,miles,clean(body.notes,400)).run();
      return json({success:true,id});
    }
    if(type==='sponsor'){
      const id=crypto.randomUUID(),name=clean(body.vendor||body.description,180),amount=number(body.amount),frequency=choice(body.frequency,['Monthly','Quarterly','Annual'],'Annual'),status=choice(body.status,['Due','Paid','Overdue'],'Due'),nextDue=cleanDate(body.next_due,true),email=cleanEmail(body.contact_email);
      if(!name)return json({error:'Sponsor name is required.'},400);
      await env.SPORTS_DB.prepare(`INSERT INTO business_sponsors (id,name,contact_email,amount,frequency,status,next_due,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(id,name,email,amount,frequency,status,nextDue,clean(body.notes,500)).run();
      return json({success:true,id});
    }
    return json({error:'Unknown entry type.'},400);
  }catch(error){console.error('business api error',error);return json({error:'The entry could not be saved.'},500)}
}

async function schema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS business_transactions (id TEXT PRIMARY KEY,type TEXT NOT NULL,date TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,category TEXT,vendor TEXT,description TEXT,source TEXT NOT NULL DEFAULT 'manual',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS business_sponsors (id TEXT PRIMARY KEY,name TEXT NOT NULL,contact_email TEXT,amount REAL NOT NULL DEFAULT 0,frequency TEXT NOT NULL DEFAULT 'Annual',status TEXT NOT NULL DEFAULT 'Due',next_due TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS business_mileage (id TEXT PRIMARY KEY,date TEXT NOT NULL,starting_point TEXT,destination TEXT,purpose TEXT NOT NULL,miles REAL NOT NULL DEFAULT 0,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

async function seedStartingLedger(db){
  const row=await db.prepare(`SELECT COUNT(*) AS count FROM business_transactions`).first();if(Number(row?.count||0)>0)return;
  const seeds=[
    ['seed-godaddy','expense','2026-09-13',93.18,'Website & Domains','GoDaddy','kanabsports.com + Better Out East URL purchase','starting-ledger'],
    ['seed-m365','expense','2026-09-13',25.90,'Email & Software','Microsoft 365','Kanab Sports Email Essentials annual plan','starting-ledger'],
    ['seed-credits','expense','2026-09-13',4.00,'Software','Credits','Credits','starting-ledger'],
    ['seed-tapstitch-main','expense','2026-08-29',116.18,'Apparel Samples','TapStitch','Apparel sample order 1543236378551373824','starting-ledger'],
    ['seed-tapstitch-tee','expense','2026-09-13',13.84,'Apparel Samples','TapStitch','Tee sample order','starting-ledger'],
    ['seed-printify','expense','2026-09-13',17.71,'Apparel Samples','Printify','Tee sample','starting-ledger']
  ];
  for(const s of seeds)await db.prepare(`INSERT OR IGNORE INTO business_transactions (id,type,date,amount,category,vendor,description,source,created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).bind(...s).run();
}

async function authenticate(request,db){await authSchema(db);const cookie=request.headers.get('Cookie')||'',match=cookie.match(/(?:^|;\s*)ks_admin=([^;]+)/);if(!match)return null;const hash=await sha256(decodeURIComponent(match[1]));return db.prepare(`SELECT email FROM admin_sessions WHERE token_hash=? AND email=? AND datetime(expires_at)>datetime('now') LIMIT 1`).bind(hash,OWNER_EMAIL).first()}
async function authSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function clean(v,max=500){return String(v||'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
function cleanDate(v,allowBlank=false){const s=clean(v,20);if(!s)return allowBlank?'':'';return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function cleanEmail(v){const s=clean(v,254).toLowerCase();return !s||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:''}
function number(v){const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0}
function choice(v,allowed,fallback){const s=clean(v,40);return allowed.includes(s)?s:fallback}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

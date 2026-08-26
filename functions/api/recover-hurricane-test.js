const EXPECTED_TOKEN_HASH='9d2f71c62690b7643ea83ac1579cacf18c34d9c192909cf1472853dee3df83ee';
const ADMIN_EMAIL='howdy@kanabsports.com';

export async function onRequestPost({ request, env }) {
  if (!env.SPORTS_DB || !env.RESEND_API_KEY) return json({success:false,error:'Not configured.'},503);
  const supplied=request.headers.get('x-recovery-token')||'';
  if(!supplied||!constantTimeEqual(await sha256(supplied),EXPECTED_TOKEN_HASH))return json({success:false,error:'Unauthorized.'},401);
  const form=await request.formData(),file=form.get('pdf');
  if(!file||typeof file.arrayBuffer!=='function')return json({success:false,error:'PDF required.'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')return json({success:false,error:'Invalid PDF.'},415);
  await ensureSchema(env.SPORTS_DB);
  const id='hurricane-football-dev-test-2026-27',reviewToken=randomToken(),reviewHash=await sha256(reviewToken),expires=new Date(Date.now()+7*86400000).toISOString();
  const payload={
    title:'Hurricane Tigers Football',season:'2026–27',level:'Varsity',
    summary:{overall:'2–0',region:'0–0',home:'0–0',away:'2–0','PF / PA':'96 / 32'},
    schedule:[
      {date:'Aug 14, 2026',time:'7:00 PM',opponent:'at Virgin Valley',site:'Away',result:'W 47–12'},
      {date:'Aug 21, 2026',time:'7:00 PM',opponent:'at Moapa Valley',site:'Away',result:'W 49–20'},
      {date:'Aug 28, 2026',time:'7:00 PM',opponent:'Murray',site:'Home',result:''},
      {date:'Sep 4, 2026',time:'7:00 PM',opponent:'Grantsville',site:'Home',result:''},
      {date:'Sep 11, 2026',time:'7:00 PM',opponent:'at Crimson Cliffs*',site:'Away',result:''},
      {date:'Sep 18, 2026',time:'7:00 PM',opponent:'Dixie*',site:'Home',result:''},
      {date:'Sep 25, 2026',time:'7:00 PM',opponent:'Pine View*',site:'Home',result:''},
      {date:'Oct 2, 2026',time:'7:00 PM',opponent:'at Snow Canyon*',site:'Away',result:''},
      {date:'Oct 7, 2026',time:'7:00 PM',opponent:'at Roy',site:'Away',result:''},
      {date:'Oct 14, 2026',time:'7:00 PM',opponent:'Desert Hills*',site:'Home',result:''}
    ],
    roster:[
      {number:'0',name:'Max Hutchings',grade:'Sr.'},{number:'1',name:'Titan Borchardt',grade:'Jr.'},{number:'2',name:'Colten Higgins',grade:'Sr.'},{number:'3',name:'Parker Hurst',grade:'Sr.'},{number:'4',name:'Joseph Licalzi',grade:'Sr.'},{number:'5',name:'Brad Rose',grade:'Sr.'},{number:'6',name:'Carter Wardle',grade:'Sr.'},{number:'7',name:'Cameron Lemmon',grade:'Jr.'},{number:'9',name:'Toa Numera',grade:'Jr.'},{number:'10',name:'Drake Gines',grade:'Jr.'},{number:'11',name:'Kannon Cowan',grade:'Jr.'},{number:'12',name:'Parker Rasmussen',grade:'Jr.'},{number:'13',name:'Gunner Higgins',grade:'Sr.'},{number:'14',name:'Kaden Farr',grade:'Jr.'},{number:'15',name:'Kace Kirschbaum',grade:'Jr.'},{number:'16',name:'Weston Boiline',grade:'Sr.'},{number:'17',name:'Carver Vanvalkenburg',grade:'Jr.'},{number:'18',name:'Russ Ellison',grade:'Sr.'},{number:'19',name:'Liam Stout',grade:'Sr.'},{number:'20',name:'Ben Martz',grade:'Jr.'},{number:'21',name:'Bentley Fischer',grade:'Sr.'},{number:'22',name:'Rhys Hirschi',grade:'So.'},{number:'24',name:'RJ Allred',grade:'Sr.'},{number:'25',name:'Porter Allred',grade:'Sr.'},{number:'26',name:'Tyrese Ali',grade:'So.'},{number:'27',name:'Preston Bladen',grade:'So.'},{number:'30',name:'Krew Web',grade:'So.'},{number:'32',name:'Camden Denton',grade:'Jr.'},{number:'34',name:'Zane Stout',grade:'Jr.'},{number:'36',name:'Dax Alley',grade:'Sr.'},{number:'50',name:'Mckabe Gardner',grade:'Sr.'},{number:'51',name:'Carter Spendlove',grade:'Sr.'},{number:'52',name:'Tanner Matua',grade:'Sr.'},{number:'53',name:'Quinn Merrit',grade:'Jr.'},{number:'54',name:'Tyson Peterson',grade:'Sr.'},{number:'55',name:'Kole Ireland',grade:'Sr.'},{number:'56',name:'Darren Jackson',grade:'Jr.'},{number:'57',name:'Gunner Gardner',grade:'Jr.'},{number:'58',name:'Eli Barlow',grade:'Jr.'},{number:'59',name:'Kelvin Barlow',grade:'So.'},{number:'60',name:'Garret Fischer',grade:'Jr.'},{number:'62',name:'Behr Kimber',grade:'Jr.'},{number:'63',name:'Andre Tamayo',grade:'So.'},{number:'68',name:'Boston Johnson',grade:'Jr.'},{number:'70',name:'Tucker Nay',grade:'Sr.'},{number:'75',name:'Taysen Augustus',grade:'So.'}
    ],
    note:'WEBSITE TEST — SAMPLE UPLOAD ONLY. Source: MaxPreps. Information retrieved Aug. 26, 2026.'
  };
  await env.SPORTS_DB.batch([
    env.SPORTS_DB.prepare(`DELETE FROM dev_documents WHERE document_id=?`).bind(id),
    env.SPORTS_DB.prepare(`DELETE FROM coach_documents WHERE id=?`).bind(id),
    env.SPORTS_DB.prepare(`INSERT INTO coach_documents (id,verification_id,name,email,sport,team,document_type,season,notes,filename,byte_size,status,review_token_hash,review_expires_at,is_test,test_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,0,NULL,datetime('now'))`).bind(id,'recovered-submission','Jeff Roth','mr.roth@mac.com','Football','Hurricane High School','Roster and schedule','2026–27','WEBSITE TEST — SAMPLE UPLOAD ONLY',safeName(file.name),bytes.byteLength,reviewHash,expires),
    env.SPORTS_DB.prepare(`INSERT INTO dev_documents (document_id,slug,payload_json,updated_at) VALUES (?,?,?,datetime('now'))`).bind(id,'hurricane-football-2026-27',JSON.stringify(payload))
  ]);
  const origin=new URL(request.url).origin,approve=`${origin}/review?token=${encodeURIComponent(reviewToken)}&action=approve`,reject=`${origin}/review?token=${encodeURIComponent(reviewToken)}&action=reject`;
  const subject='DEV TEST — Hurricane football roster & schedule';
  const text=`Verified email — Jeff Roth uploaded a roster and schedule for Hurricane Football, 2026–27.\n\nApprove: ${approve}\nDeny: ${reject}\n\nThe PDF is attached. Approval publishes the structured roster and schedule only on the development preview page.`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px"><div style="font-size:12px;font-weight:800;color:#a51420;text-transform:uppercase">Development test</div><h2>Hurricane football roster &amp; schedule</h2><p><strong>Verified email</strong> — Jeff Roth submitted the 2026–27 varsity roster and schedule.</p><p>The PDF is attached. Approval makes the structured version visible only on the development preview page.</p><div style="margin:24px 0"><a href="${escapeHtml(approve)}" style="display:inline-block;background:#16833a;color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:8px;margin-right:8px">Approve</a><a href="${escapeHtml(reject)}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:8px">Deny</a></div><p style="font-size:12px;color:#666">Review link expires in 7 days.</p></div>`;
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`recover-${id}-${Date.now()}`},body:JSON.stringify({from:'Kanab Sports <website@kanabsports.com>',to:[ADMIN_EMAIL],reply_to:'mr.roth@mac.com',subject,text,html,attachments:[{filename:safeName(file.name),content:toBase64(bytes)}]})});
  if(!sent.ok)return json({success:false,error:'Email service rejected the message.'},502);
  return json({success:true,message:'Approval email sent.'});
}

async function ensureSchema(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS coach_documents (id TEXT PRIMARY KEY,verification_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,sport TEXT NOT NULL,team TEXT NOT NULL,document_type TEXT NOT NULL,season TEXT NOT NULL,notes TEXT,filename TEXT NOT NULL,byte_size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_token_hash TEXT,review_expires_at TEXT,is_test INTEGER NOT NULL DEFAULT 0,test_expires_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS dev_documents (document_id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}
function randomToken(){const b=crypto.getRandomValues(new Uint8Array(24));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
async function sha256(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
function constantTimeEqual(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
function toBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)}
function safeName(v){const s=String(v||'coach-document.pdf').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120);return /\.pdf$/i.test(s)?s:`${s}.pdf`}
function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

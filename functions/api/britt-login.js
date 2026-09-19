const COOKIE='britt_coach_session';
export async function onRequestPost({request}){
 let b;try{b=await request.json()}catch{return json({success:false},400)}
 const p=String(b.password||'').trim().toLowerCase();
 const coach=p==='britt'?'Britt Roth':p==='jodi'?'Jodi Palmer':null;
 if(!coach)return json({success:false,error:'Wrong password.'},401);
 const value=btoa(JSON.stringify({coach,exp:Date.now()+24*60*60*1000}));
 return new Response(JSON.stringify({success:true,coach}),{headers:{'Content-Type':'application/json','Set-Cookie':COOKIE+'='+encodeURIComponent(value)+'; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict','Cache-Control':'no-store'}});
}
export async function onRequestGet({request}){const v=cookie(request,COOKIE);if(!v)return json({success:false},401);try{const d=JSON.parse(atob(v));if(!d.coach||d.exp<Date.now())return json({success:false},401);return json({success:true,coach:d.coach})}catch{return json({success:false},401)}}
export async function onRequestDelete(){return new Response(JSON.stringify({success:true}),{headers:{'Content-Type':'application/json','Set-Cookie':COOKIE+'=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'}})}
function cookie(r,n){const m=(r.headers.get('Cookie')||'').match(new RegExp('(?:^|;\\s*)'+n+'=([^;]+)'));return m?decodeURIComponent(m[1]):''}
function json(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}

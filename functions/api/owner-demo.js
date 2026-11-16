import {owner,roles,demoCookie,resetDemo} from '../_lib/owner-demo.js';
import {json,sha256} from '../_lib/coach-auth.js';
export async function onRequestPost({request,env}){
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open your owner console to continue.'},403);
 if(!await owner(request,env))return json({error:'Sign in as howdy@kanabsports.com first.'},401);
 let body;try{body=await request.json()}catch{return json({error:'Invalid request.'},400)}
 if(body.action==='remember'){
  const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)ks_admin=([^;]+)/)?.[1];
  await env.SPORTS_DB.prepare('UPDATE admin_sessions SET expires_at=? WHERE token_hash=?').bind(new Date(Date.now()+2592000000).toISOString(),await sha256(decodeURIComponent(token))).run();
  const r=json({success:true});r.headers.set('Set-Cookie',`ks_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);return r;
 }
 if(body.action==='reset'){await resetDemo(env.SPORTS_DB);return json({success:true});}
 if(body.action!=='exit'&&!roles.includes(body.role))return json({error:'Choose a demo role.'},400);
 const role=body.action==='exit'?'':body.role;
 const response=json({success:true,url:role?(role==='parent'?'/family/':'/coaches'):'/admin'});
 response.headers.set('Set-Cookie',demoCookie(role));return response;
}

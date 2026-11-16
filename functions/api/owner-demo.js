import {owner,roles,demoCookie,resetDemo} from '../_lib/owner-demo.js';
import {json} from '../_lib/coach-auth.js';
export async function onRequestPost({request,env}){
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Open your owner console to continue.'},403);
 if(!await owner(request,env))return json({error:'Sign in as howdy@kanabsports.com first.'},401);
 let body;try{body=await request.json()}catch{return json({error:'Invalid request.'},400)}
 if(body.action==='remember')return json({success:true}); // Launching a preview never postpones the sign-in check.
 if(body.action==='reset'){await resetDemo(env.SPORTS_DB);return json({success:true});}
 if(body.action!=='exit'&&!roles.includes(body.role))return json({error:'Choose a demo role.'},400);
 const role=body.action==='exit'?'':body.role;
 const response=json({success:true,url:role?(role==='parent'?'/family/':'/coaches'):'/admin'});
 response.headers.set('Set-Cookie',demoCookie(role));return response;
}

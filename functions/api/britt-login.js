import {authorized,json} from '../_lib/pilot.js';
export async function onRequestGet({request,env}){const m=await authorized(request,env.SPORTS_DB);return m?json({success:true,coach:m.name}):json({success:false,error:'Sign in at /team-d/.'},401);}
export function onRequestPost(){return json({success:false,error:'Password login has been replaced. Open /team-d/ and verify your email.'},410);}

import {getCoach,ensureCoachCore,json} from '../_lib/coach-auth.js';

export async function onRequestGet({request,env}){
  if(!env.SPORTS_DB)return json({signedIn:false,error:'Coach accounts are temporarily unavailable.'},503);
  try{
    await ensureCoachCore(env.SPORTS_DB);
    const coach=await getCoach(request,env.SPORTS_DB);
    if(!coach)return json({signedIn:false});
    return json({
      signedIn:true,
      coach:{
        id:coach.id,
        name:coach.name,
        email:coach.email,
        phone:coach.phone||'',
        organization:coach.organization,
        team:coach.team_name||coach.organization,
        sport:coach.sport,
        role:coach.role,
        canManageAssistants:!/assistant/i.test(String(coach.role||''))
      }
    });
  }catch(error){
    console.error('coach profile error',error);
    return json({signedIn:false,error:'Could not load your coach account.'},500);
  }
}
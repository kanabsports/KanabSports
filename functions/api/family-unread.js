import {parentSession} from '../_lib/parent-access.js';
import {ensureCoachCore,json} from '../_lib/coach-auth.js';
import {familyUnread} from '../_lib/family-unread.js';

export async function onRequestGet({request,env}){
 const db=env.SPORTS_DB;if(!db)return json({error:'Unread count unavailable.'},503);
 try{
  await ensureCoachCore(db);const parent=await parentSession(request,db);
  if(!parent)return json({error:'Sign in to My Family to sync unread items.'},401);
  const response=json({success:true,...await familyUnread(db,parent.email,env)});response.headers.set('Cache-Control','no-store');return response;
 }catch(error){console.error('family unread error',error);return json({error:'Unread count unavailable.'},503)}
}

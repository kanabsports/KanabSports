import {json} from '../_lib/coach-auth.js';
import {identity} from '../_lib/private-messages.js';
import {CATEGORIES,preferences} from '../_lib/notification-preferences.js';
export async function onRequest({request,env}){
 if(!env.SPORTS_DB)return json({error:'Preferences unavailable.'},503);
 try{const url=new URL(request.url),actor=await identity(request,env.SPORTS_DB,url.searchParams.get('role'));if(!actor)return json({error:'Sign in first.'},401);
 const db=env.SPORTS_DB,current=await preferences(db,actor.role,actor.id);
 if(request.method==='GET')return json({preferences:current});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==url.origin)return json({error:'Open Pep to update preferences.'},403);
 const text=await request.text();if(text.length>3000)return json({error:'Request too large.'},413);
 const b=JSON.parse(text);if(!Array.isArray(b.preferences)||b.preferences.length!==CATEGORIES.length||new Set(b.preferences.map(x=>x.category)).size!==CATEGORIES.length||b.preferences.some(x=>!CATEGORIES.includes(x.category)||typeof x.email_muted!=='boolean'||typeof x.push_muted!=='boolean'))return json({error:'Invalid preferences.'},400);
 await db.batch(b.preferences.map(x=>db.prepare('INSERT INTO notification_preferences VALUES(?,?,?,?,?) ON CONFLICT(role,identity,category) DO UPDATE SET email_muted=excluded.email_muted,push_muted=excluded.push_muted').bind(actor.role,actor.id,x.category,+x.email_muted,+x.push_muted)));return json({saved:true});
 }catch{return json({error:'Preferences could not be saved.'},400);}
}

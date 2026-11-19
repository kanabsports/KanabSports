import {coachFileType,validCoachFile} from '../../assets/coach-file.mjs';
import {getCoach,json} from '../_lib/coach-auth.js';
import {schema,eligibleSQL} from '../_lib/private-messages.js';
export async function onRequest({request,env}){
 if(env.PRIVATE_MESSAGING_ENABLED!=='true'||!env.SPORTS_DB)return json({error:'Coach tools pilot is not enabled.'},503);
 try{const db=env.SPORTS_DB,url=new URL(request.url),coach=await getCoach(request,db);if(!coach)return json({error:'Sign in with your approved coach account.'},401);await schema(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS coach_stats_pdfs(id TEXT PRIMARY KEY,team_code TEXT NOT NULL,organization_id TEXT NOT NULL,coach_id TEXT NOT NULL,filename TEXT NOT NULL,object_key TEXT NOT NULL,created INTEGER NOT NULL)').run();
 const teams=(await db.prepare(eligibleSQL+' AND a.id=?').bind(coach.id).all()).results||[];
 if(request.method==='GET'){
 const id=url.searchParams.get('id');if(id){const row=await db.prepare('SELECT * FROM coach_stats_pdfs WHERE id=? AND coach_id=?').bind(id,coach.id).first();if(!row||!teams.some(t=>t.team_code===row.team_code&&t.organization_id===row.organization_id))return json({error:'File unavailable.'},404);if(!env.SPORTS_FILES)return json({error:'Private file storage is not configured.'},503);const object=await env.SPORTS_FILES.get(row.object_key);if(!object)return json({error:'File unavailable.'},404);return new Response(object.body,{headers:{'Content-Type':coachFileType(row.filename)||'application/octet-stream','Content-Disposition':'attachment; filename="'+row.filename+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 const rows=(await db.prepare('SELECT id,team_code,organization_id,filename,created FROM coach_stats_pdfs WHERE coach_id=? ORDER BY created DESC LIMIT 50').bind(coach.id).all()).results||[];return json({files:rows.filter(r=>teams.some(t=>t.team_code===r.team_code&&t.organization_id===r.organization_id)),teams,storageReady:!!env.SPORTS_FILES});
 }
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);if(request.headers.get('Origin')!==url.origin)return json({error:'Open the Coach Portal to upload.'},403);if(!env.SPORTS_FILES)return json({error:'Private file storage needs the SPORTS_FILES bucket binding.'},503);
 if(Number(request.headers.get('Content-Length')||0)>6*1024*1024)return json({error:'File must be 5 MB or smaller.'},413);
 const form=await request.formData(),team=teams.find(t=>t.team_code===form.get('team_code')),file=form.get('pdf');if(!team)return json({error:'Team unavailable.'},403);
 if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>5*1024*1024)return json({error:'Choose a stats file up to 5 MB.'},400);
 const bytes=await file.arrayBuffer();if(!validCoachFile(file.name,new Uint8Array(bytes)))return json({error:'Choose a valid CSV, PDF, JPG, PNG, or WebP file.'},415);
 const id=crypto.randomUUID(),key='coach-stats/'+id,filename=file.name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120);
 await env.SPORTS_FILES.put(key,bytes,{httpMetadata:{contentType:coachFileType(file.name)}});
 try{await db.prepare('INSERT INTO coach_stats_pdfs VALUES(?,?,?,?,?,?,?)').bind(id,team.team_code,team.organization_id,coach.id,filename,key,Date.now()).run();}catch(e){await env.SPORTS_FILES.delete(key);throw e;}
 return json({saved:true,id,message:'Stats file uploaded privately. Numeric stats are not auto-extracted or published.'});
 }catch{return json({error:'Stats upload could not complete.'},503);}
}

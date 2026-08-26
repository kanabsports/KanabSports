export async function onRequestPost(context){
  const{request,env}=context;
  if(!env.COACH_ACCESS_CODE)return json({valid:false,error:'Coach access is not configured.'},503);
  try{
    const body=await request.json();
    const supplied=String(body?.code||'').trim().toUpperCase();
    const expected=String(env.COACH_ACCESS_CODE||'').trim().toUpperCase();
    return json({valid:Boolean(supplied)&&supplied===expected});
  }catch{return json({valid:false},400)}
}
export function onRequestGet(){return json({valid:false},405)}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

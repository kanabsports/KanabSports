// The Team D pilot and its authentication/data modules were removed previously.
// Keep a deliberate response for old clients without restoring pilot access.
export function onRequest(){
  return new Response(JSON.stringify({success:false,error:'The Team D pilot assistant has been retired. Use your current coach portal.'}),{
    status:410,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
}

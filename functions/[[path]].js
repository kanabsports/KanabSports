export async function onRequest(context){
  const response=await context.next();
  const url=new URL(context.request.url);
  if(url.pathname!=='/'&&url.pathname!=='/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let html=await response.text();
  if(!html.includes('/happening-sort.js'))html=html.replace('</body>','<script src="/happening-sort.js" defer></script>\n</body>');
  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

export async function onRequest(context){
  const response=await context.next();
  const url=new URL(context.request.url);
  if(url.pathname!=='/'&&url.pathname!=='/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let html=await response.text();
  const updates=`<section class="section white" id="submit-update"><div class="wrap"><div class="section-head"><div><div class="eyebrow">Help keep it current</div><h2>Submit an Update</h2></div><p>Know a score, event, or correction we should have? Send it in. Nothing publishes until Kanab Sports reviews it.</p></div><div class="quick" style="margin-top:0"><a href="/updates.html?type=Score">Submit a Score →</a><a href="/updates.html?type=Event">Submit an Event →</a><a href="/updates.html?type=Correction">Submit a Correction →</a></div></div></section>`;
  if(!html.includes('id="submit-update"')){
    html=html.replace('<section class="section" id="contact">',updates+'\n<section class="section" id="contact">');
    html=html.replace('<section class="section white" id="contact">',updates+'\n<section class="section white" id="contact">');
  }
  if(!html.includes('/happening-sort.js'))html=html.replace('</body>','<script src="/happening-sort.js" defer></script>\n</body>');
  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

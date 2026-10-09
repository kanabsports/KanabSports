import {removeBullsharksTest} from './_migrations/remove-bullsharks-test.js';
export async function onRequest(context) {
  const url0=new URL(context.request.url);
  let cleanupRows=null;
  if(url0.hostname==='kanabsports.com'&&context.env.SPORTS_DB){
    try{cleanupRows=(await removeBullsharksTest(context.env.SPORTS_DB,context.env))?.deleted_rows??null}catch(error){console.error('Approved test cleanup failed',error?.message)}
  }
  if(['/team-d/','/team-d','/britt/','/britt','/britt.html','/jodi/','/jodi','/jodi.html','/amber/','/amber'].includes(url0.pathname))return Response.redirect(new URL('/coaches',url0.origin),301);
  if(['/admin','/admin/','/admin.html','/business','/business.html','/owner-sw.js','/owner.webmanifest','/assets/owner-push.js','/assets/coach-push.js','/assets/family-push.js','/assets/notification-panel.js'].includes(url0.pathname)){
    const response=await context.next();
    const headers=new Headers(response.headers);
    headers.set('Cache-Control','private, no-store, max-age=0');
    headers.set('X-Owner-Console-Version','2026-10-07-owner-pwa-v1');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
  let response = await context.next();
  if(cleanupRows!==null){const h=new Headers(response.headers);h.set('X-Pep-Test-Cleanup','completed; rows='+cleanupRows);response=new Response(response.body,{status:response.status,statusText:response.statusText,headers:h})}
  const url = new URL(context.request.url);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  let html = await response.text();

  html = html.replace('</head>', `<style id="coachesNavHighlight">.links a[href="/coaches.html"],.mobile-menu a[href="/coaches.html"]{color:#e32636!important}.links a[href="/coaches.html"]:hover,.mobile-menu a[href="/coaches.html"]:hover{color:#ff5361!important}</style>\n</head>`);

  if (url.pathname === '/coaches.html' || url.pathname === '/coaches') {
    const guard=`<script id="coachTurnstileGuard">(function(){const form=document.getElementById('coachForm'),button=document.getElementById('submitButton'),status=document.getElementById('coachStatus'),widget=document.querySelector('.cf-turnstile'),type=document.getElementById('type'),result=document.getElementById('result');if(!form||!button||!status||!widget)return;const token=()=>form.querySelector('input[name="cf-turnstile-response"]')?.value;form.addEventListener('submit',e=>{if(token())return;e.preventDefault();e.stopImmediatePropagation();status.textContent='Waiting for verification…';button.disabled=false},true)})();</script>`;if(!html.includes('id="coachTurnstileGuard"'))html=html.replace('</body>',guard+'\n</body>')
  }
  if(!html.includes('/assets/coach-autofill.js'))html=html.replace('</body>','<script src="/assets/coach-autofill.js" defer></script>\n</body>');
  const headers=new Headers(response.headers);headers.delete('content-length');
  if(url.pathname==='/'||url.pathname==='/index.html'||url.pathname==='/homecoming/'||url.pathname==='/homecoming')headers.set('Cache-Control','no-store');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

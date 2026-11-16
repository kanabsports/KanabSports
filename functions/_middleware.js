import {demoRole,roles,owner,demoApi,decorateDemo} from './_lib/owner-demo.js';
import {syncAssistantAccess} from './_lib/assistant-coaches.js';
import {expirePass} from './_lib/travel-pass.js';
import {removeBullsharksTest} from './_migrations/remove-bullsharks-test.js';
export async function onRequest(context) {
  const url0=new URL(context.request.url);
  if(url0.pathname==='/api/owner-demo')return context.next();
  const preview=demoRole(context.request);
  if(preview && !['/api/owner-demo','/api/admin-auth'].includes(url0.pathname)){
    if(!roles.includes(preview)||!await owner(context.request,context.env)){
      if(['/admin','/admin.html','/admin/'].includes(url0.pathname))return new Response(null,{status:302,headers:{Location:'/admin?sign_in=1','Cache-Control':'no-store','Set-Cookie':'ks_owner_demo=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
      return new Response(url0.pathname.startsWith('/api/')?JSON.stringify({error:'Owner session expired. Sign in as howdy@kanabsports.com.'}):'Owner session expired. Open /admin to sign in as howdy@kanabsports.com.',{status:401,headers:{'Content-Type':url0.pathname.startsWith('/api/')?'application/json':'text/plain','Cache-Control':'no-store','Set-Cookie':'ks_owner_demo=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
    }
    if(url0.pathname.startsWith('/api/'))return demoApi(context.request,context.env,preview);
    if(!['GET','HEAD'].includes(context.request.method))return new Response('Demo mode: real submissions are disabled.',{status:403});
    const pages=['/','/coaches','/coaches.html','/family','/family/','/family/index.html','/admin','/admin.html','/assistant-coaches','/assistant-coaches.html','/coach-tools/','/coach-tools/index.html','/messages/','/messages/index.html','/messages/team.html','/coach-documents','/coach-documents.html','/school-roster','/school-roster.html','/score-assistants','/score-assistants.html'];
    if(!pages.includes(url0.pathname)&&!url0.pathname.startsWith('/assets/'))return new Response('This route is disabled in demo mode. Return to your demo portal or owner console.',{status:403,headers:{'Cache-Control':'no-store'}});
    const response=await context.next();
    if(!(response.headers.get('Content-Type')||'').includes('text/html'))return response;
    const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','private, no-store');headers.set('Content-Security-Policy',"form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'");
    return new Response(decorateDemo(await response.text(),preview),{status:response.status,headers});
  }
  if(context.env.SPORTS_DB && (url0.pathname.startsWith('/api/') || ['/coach-access-review','/review','/coach-register'].includes(url0.pathname))){await expirePass(context.env.SPORTS_DB);await syncAssistantAccess(context.env.SPORTS_DB);}
  let cleanupRows=null;
  if(url0.hostname==='kanabsports.com'&&context.env.SPORTS_DB){
    try{cleanupRows=(await removeBullsharksTest(context.env.SPORTS_DB,context.env))?.deleted_rows??null}catch(error){console.error('Approved test cleanup failed',error?.message)}
  }
  if(['/britt/','/britt','/britt.html','/jodi/','/jodi','/jodi.html','/amber/','/amber'].includes(url0.pathname))return Response.redirect(new URL('/coaches',url0.origin),301);
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

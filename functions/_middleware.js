export async function onRequest(context) {
  const url0=new URL(context.request.url);
  if((url0.pathname==='/britt/'||url0.pathname==='/britt'||url0.pathname==='/britt.html'||url0.pathname==='/jodi/'||url0.pathname==='/jodi'||url0.pathname==='/jodi.html')&&!validBrittSession(context.request)){
    return new Response(loginPage(),{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  const response = await context.next();
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

function validBrittSession(request){const m=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)britt_coach_session=([^;]+)/);if(!m)return false;try{const d=JSON.parse(atob(decodeURIComponent(m[1])));return !!d.coach&&d.exp>Date.now()}catch{return false}}
function loginPage(){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coach Access | Kanab Sports</title><style>*{box-sizing:border-box}body{margin:0;background:#0b0c0f;font-family:Inter,system-ui;color:#111;min-height:100vh;display:grid;place-items:center;padding:20px}.box{width:min(390px,100%);background:#fff;border-radius:18px;padding:28px}.ey{color:#e32636;font-size:11px;font-weight:950;letter-spacing:1.4px;text-transform:uppercase}h1{margin:6px 0 8px;font-size:34px}p{color:#747780}input{width:100%;padding:14px;border:1px solid #ccc;border-radius:10px;font:inherit;margin:10px 0}button{width:100%;border:0;border-radius:10px;background:#e32636;color:#fff;padding:14px;font-weight:900;font-size:15px}.err{color:#b51d29;font-size:13px;font-weight:800;margin-top:10px}</style></head><body><div class="box"><div class="ey">Kanab Sports · Coach Access</div><h1>Britt's Team</h1><p>Enter your coach password to continue.</p><form id="f"><input id="p" type="password" autocomplete="current-password" placeholder="Password" autofocus required><button>Open Coach Portal</button><div class="err" id="e"></div></form></div><script>f.onsubmit=async x=>{x.preventDefault();e.textContent='';const r=await fetch('/api/britt-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})});if(r.ok)location.reload();else e.textContent='That password did not work.'}</script></body></html>`}

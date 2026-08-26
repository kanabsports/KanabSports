export async function onRequest(context){
  const response=await context.next();
  const url=new URL(context.request.url);
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let html=await response.text();

  if(url.pathname==='/'||url.pathname==='/index.html'){
    const updates=`<section class="section white" id="submit-update"><div class="wrap"><div class="section-head"><div><div class="eyebrow">Help keep it current</div><h2>Submit an Update</h2></div><p>Know an event or correction we should have? Send it in. Nothing publishes until Kanab Sports reviews it.</p></div><div class="quick" style="margin-top:0"><a href="/updates.html?type=Event">Submit an Event →</a><a href="/updates.html?type=Correction">Submit a Correction →</a></div></div></section>`;
    if(!html.includes('id="submit-update"')){
      html=html.replace('<section class="section" id="contact">',updates+'\n<section class="section" id="contact">');
      html=html.replace('<section class="section white" id="contact">',updates+'\n<section class="section white" id="contact">');
    }
    html=html.replaceAll('href="#registration"','href="#rec"');
    if(!html.includes('id="ks-home-tweaks"'))html=html.replace('</head>',`<style id="ks-home-tweaks">.scores-ticker-shell{margin-top:8px!important}</style></head>`);
    if(!html.includes('/happening-sort.js'))html=html.replace('</body>','<script src="/happening-sort.js" defer></script>\n</body>');
  }

  if(url.pathname==='/coaches.html'||url.pathname==='/coaches'){
    if(!html.includes('id="coachAccessUi"')){
      const ui=`<script id="coachAccessUi">(function(){const form=document.getElementById('coachForm'),hero=document.querySelector('.hero-note'),type=document.getElementById('type');if(!form)return;const code=document.createElement('div');code.className='field full';code.id='coachAccessField';code.innerHTML='<label for="coachAccessCode">Coach access code</label><input id="coachAccessCode" name="coach_code" type="password" inputmode="text" autocomplete="off" placeholder="Enter coach code" required><small id="coachAccessStatus" style="color:#9da0a7;font-size:12px">Required to submit coach-only updates.</small>';form.insertBefore(code,form.firstElementChild.nextSibling);if(hero&&!document.getElementById('coachScoreCta')){const a=document.createElement('a');a.id='coachScoreCta';a.href='#submit';a.textContent='Submit a Score';a.style.cssText='display:inline-flex;margin-left:10px;background:#e32636;color:#fff;text-decoration:none;font-weight:950;text-transform:uppercase;letter-spacing:.8px;font-size:11px;padding:10px 14px;border-radius:9px';hero.insertAdjacentElement('afterend',a)}const input=document.getElementById('coachAccessCode'),status=document.getElementById('coachAccessStatus');let timer;async function check(){const value=input.value.trim();const champ=document.getElementById('championshipField');if(!value){status.textContent='Required to submit coach-only updates.';status.style.color='#9da0a7';if(champ)champ.style.display='none';return}try{const r=await fetch('/api/coach-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:value})});const data=await r.json();if(data.valid){status.textContent='Coach access unlocked.';status.style.color='#7de197';if(champ&&(type?.value||'Score')==='Score')champ.style.display='flex'}else{status.textContent='That code does not match.';status.style.color='#ff9ba4';if(champ)champ.style.display='none'}}catch{status.textContent='Could not verify code yet.';status.style.color='#ffcf7d'}}input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(check,350)});type?.addEventListener('change',()=>setTimeout(check,0));setTimeout(()=>{const champ=document.getElementById('championshipField');if(champ)champ.style.display='none'},50)})();</script>`;
      html=html.replace('</body>',ui+'\n</body>');
    }
  }

  if(url.pathname==='/updates.html'){
    if(!html.includes('id="communityScoreAccessUi"')){
      const ui=`<script id="communityScoreAccessUi">(function(){const form=document.getElementById('updateForm'),type=document.getElementById('type');if(!form||!type)return;const field=document.createElement('div');field.className='field full';field.id='communityCoachCode';field.innerHTML='<label>Coach access code<input name="coach_code" type="password" autocomplete="off" placeholder="Required for score submissions"></label><div style="font-size:12px;color:#9da0a7;margin-top:5px">Events and corrections do not need a coach code.</div>';const team=[...form.querySelectorAll('.field')].find(x=>x.textContent.includes('Team / Organization'));(team||form.firstElementChild).insertAdjacentElement('beforebegin',field);function sync(){field.style.display=type.value==='Score'?'flex':'none';const input=field.querySelector('input');input.required=type.value==='Score'}const obs=new MutationObserver(sync);obs.observe(type,{attributes:true,attributeFilter:['value']});document.querySelectorAll('.choice').forEach(b=>b.addEventListener('click',()=>setTimeout(sync,0)));sync()})();</script>`;
      html=html.replace('</body>',ui+'\n</body>');
    }
  }

  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

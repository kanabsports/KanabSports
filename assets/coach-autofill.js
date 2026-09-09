(()=>{
  const $=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
  function field(name,root=document){return root.querySelector(`[name="${name}"]`)}
  function makeField(label,name,type='text'){
    const d=document.createElement('div');d.className='field';
    d.innerHTML=`<label for="ks-${name}">${label}</label><input id="ks-${name}" name="${name}" type="${type}" autocomplete="${type==='tel'?'tel':'off'}">`;
    return d;
  }
  async function verify(code){const r=await fetch('/api/coach-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});return r.json()}
  async function session(){try{const r=await fetch('/api/coach-access',{cache:'no-store'});return r.json()}catch{return{valid:false}}}
  function fill(form,coach){const vals={name:coach.name,email:coach.email,phone:coach.phone,sport:coach.sport,team:coach.team};Object.entries(vals).forEach(([k,v])=>{const el=field(k,form);if(el&&v!=null){el.value=v;el.readOnly=true;}})}
  function setupForm(form){
    if(form.dataset.ksCoachAutofill)return;form.dataset.ksCoachAutofill='1';
    let code=field('coach_code',form);
    if(!code){const wrap=makeField('Coach access code','coach_code');const first=form.querySelector('.field');first?form.insertBefore(wrap,first):form.prepend(wrap);code=wrap.querySelector('input')}
    let phone=field('phone',form);
    if(!phone){const wrap=makeField('Coach phone (optional)','phone','tel');const email=field('email',form),emailWrap=email?.closest('.field');emailWrap?.after(wrap);phone=wrap.querySelector('input')}
    const status=document.createElement('div');status.className='status';status.style.gridColumn='1/-1';status.setAttribute('aria-live','polite');code.closest('.field')?.after(status);
    const account=document.createElement('div');account.style.cssText='grid-column:1/-1;font-size:12px;color:#9da0a7;margin-top:-4px';account.innerHTML='<a href="/coach-account.html" style="color:inherit">Set your own coach password or sign in →</a>';status.after(account);
    let timer,verified=false,signedIn=false;
    async function run(){const v=code.value.trim();verified=false;if(v.length<6){status.textContent=signedIn?'✓ Signed in — your saved details are filled in.':'';return signedIn}status.textContent='Checking coach access…';try{const d=await verify(v);if(!d.valid){status.textContent='That coach code is not recognized.';return false}fill(form,d.coach||{});verified=true;status.textContent='✓ Coach verified — your saved details are filled in.';return true}catch{status.textContent='Could not verify coach access right now.';return false}}
    code.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,350)});code.addEventListener('blur',run);
    session().then(d=>{if(d.valid){signedIn=true;verified=true;fill(form,d.coach||{});code.required=false;code.closest('.field').style.display='none';status.textContent='✓ Signed in — your saved details are filled in.'}});
    if(form.id==='coachForm'){
      const type=field('type',form),publicPhone=document.createElement('div');publicPhone.className='field full';publicPhone.style.cssText='border:1px solid #343740;background:#15171b;border-radius:12px;padding:14px 16px';publicPhone.innerHTML='<label style="display:flex;align-items:center;gap:12px;color:#fff;font-size:13px;text-transform:none"><input type="checkbox" name="publish_phone" value="yes" style="width:20px;height:20px;accent-color:#e32636"><span><strong style="display:block;font-size:14px">Show my phone number publicly</strong><small style="display:block;color:#9da0a7;font-size:12px;margin-top:3px;font-weight:500">Use this when parents should text or call you to register or ask team questions.</small></span></label>';
      const message=field('message',form)?.closest('.field');message?.before(publicPhone);const syncPhone=()=>{publicPhone.style.display=(type?.value==='Team')?'flex':'none'};type?.addEventListener('change',syncPhone);document.querySelectorAll('.action[data-type]').forEach(x=>x.addEventListener('click',()=>setTimeout(syncPhone,0)));syncPhone();
      form.addEventListener('submit',async e=>{
        e.preventDefault();e.stopImmediatePropagation();
        const ok=verified||signedIn||await run();if(!ok)return;
        const submitButton=document.getElementById('submitButton'),mainStatus=document.getElementById('coachStatus'),success=document.getElementById('coachSuccess');
        if(submitButton)submitButton.disabled=true;if(mainStatus)mainStatus.textContent='Sending…';success?.classList.remove('show');
        try{const r=await fetch('/api/coach-submit',{method:'POST',body:new FormData(form)}),d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Unable to submit.');if(mainStatus)mainStatus.textContent='';success?.classList.add('show');const keepType=field('type',form)?.value;form.reset();if(typeof window.setType==='function'&&keepType)window.setType(keepType);syncPhone();}
        catch(err){if(mainStatus)mainStatus.textContent=err.message||'Something went wrong. Please try again.'}
        finally{if(submitButton)submitButton.disabled=false;if(window.turnstile)try{window.turnstile.reset()}catch{}}
      },true)
    }
  }
  const coachForm=$('#coachForm');if(coachForm)setupForm(coachForm);
  all('form').filter(f=>f.querySelector('[name="coach_code"]')&&f!==coachForm).forEach(setupForm);
})();
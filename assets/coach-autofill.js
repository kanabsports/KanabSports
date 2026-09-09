(()=>{
  const $=(s,r=document)=>r.querySelector(s), all=(s,r=document)=>[...r.querySelectorAll(s)];
  function field(name){return document.querySelector(`[name="${name}"]`)}
  function makeField(label,name,type='text'){
    const d=document.createElement('div');d.className='field';
    d.innerHTML=`<label for="ks-${name}">${label}</label><input id="ks-${name}" name="${name}" type="${type}" autocomplete="${type==='tel'?'tel':'off'}">`;
    return d;
  }
  async function verify(code){
    const r=await fetch('/api/coach-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    return r.json();
  }
  function fill(coach){
    const vals={name:coach.name,email:coach.email,phone:coach.phone,sport:coach.sport,team:coach.team};
    Object.entries(vals).forEach(([k,v])=>{const el=field(k);if(el&&v!=null){el.value=v;el.readOnly=true;}});
  }
  function setupForm(form){
    if(form.dataset.ksCoachAutofill)return;form.dataset.ksCoachAutofill='1';
    let code=field('coach_code');
    if(!code){
      const wrap=makeField('Coach access code','coach_code');
      const first=form.querySelector('.field');
      first?form.insertBefore(wrap,first):form.prepend(wrap);code=wrap.querySelector('input');
    }
    let phone=field('phone');
    if(!phone){
      const wrap=makeField('Coach phone (optional)','phone','tel');
      const email=field('email');const emailWrap=email?.closest('.field');
      emailWrap?.after(wrap);phone=wrap.querySelector('input');
    }
    const status=document.createElement('div');status.className='status';status.style.gridColumn='1/-1';status.setAttribute('aria-live','polite');
    code.closest('.field')?.after(status);
    let timer;
    async function run(){
      const v=code.value.trim();if(v.length<6){status.textContent='';return}
      status.textContent='Checking coach access…';
      try{const d=await verify(v);if(!d.valid){status.textContent='That coach code is not recognized.';return}fill(d.coach||{});status.textContent='✓ Coach verified — your saved details are filled in.';}
      catch{status.textContent='Could not verify coach access right now.'}
    }
    code.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,350)});code.addEventListener('blur',run);
  }
  const coachForm=$('#coachForm');if(coachForm)setupForm(coachForm);
  const uploadForms=all('form').filter(f=>f.querySelector('[name="coach_code"]')&&f!==coachForm);uploadForms.forEach(setupForm);
})();
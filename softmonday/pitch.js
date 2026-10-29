(function () {
  'use strict';
  const betaCheckbox = document.getElementById('beta-only');
  const betaKey = 'soft-monday-pitch-beta-only-v1';
  betaCheckbox.checked = document.documentElement.dataset.betaOnly !== 'false';
  function setBetaOnly(value, persist) {
    document.documentElement.dataset.betaOnly = String(value);
    betaCheckbox.checked = value;
    if (persist) { try { localStorage.setItem(betaKey,String(value)); } catch (_) {} }
    requestAnimationFrame(updateNavigation);
  }
  betaCheckbox.addEventListener('change',()=>setBetaOnly(betaCheckbox.checked,true));
  window.addEventListener('storage',event=>{if(event.key===betaKey)setBetaOnly(event.newValue!=='false',false);});
  const themeSelect = document.getElementById('theme');
  themeSelect.value = document.documentElement.dataset.theme;
  themeSelect.addEventListener('change', () => {
    const result = window.softMondayTheme.apply(themeSelect.value,true);
    document.getElementById('theme-status').textContent = result.name+' theme selected. '+(result.saved?'Remembered on this browser.':'Browser storage is unavailable; applied for this visit.');
  });
  window.addEventListener('storage', event => {
    if (event.key === window.softMondayTheme.key) themeSelect.value = window.softMondayTheme.apply(event.newValue,false).id;
  });
  const icon = name => '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
  const roles = {
    host: {title:'Only what you need for your shift.',text:'Your assigned tasks, your schedule and relevant updates. Open the details when you need them; ask for help without hunting down a manager.'},
    manager: {title:'Keep the team moving.',text:'See requests that need help, assign work and review selected completed tasks. Ownership, billing and staff permission changes stay with the owner.'},
    owner: {title:'The whole park. The right level of detail.',text:'See operations across your park and control who can do what. Promote a trusted host with a manager-access checkbox, or grant one specific responsibility.'}
  };
  let role = 'host';
  let started = false;
  let completed = false;
  const checks = [false,false,false];
  let managerGranted = false;
  const verified = new Set();
  let helpAssigned = false;
  const screen = document.getElementById('role-screen');
  function renderRole(nextRole) {
    role = nextRole;
    document.querySelectorAll('[data-role]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.role===role)));
    document.getElementById('role-description').innerHTML = '<h3>'+roles[role].title+'</h3><p>'+roles[role].text+'</p>';
    if (role === 'host') {
      screen.innerHTML = '<h3 class="screen-title">Your next task</h3><p class="screen-subtitle">Emily · Today, 9 AM–2 PM</p><div class="next-card"><div class="task-heading">'+icon('note')+'<div><h3>Check bathhouse</h3><p>Main Loop · About 15 min</p></div></div><div class="interactive-checks">'+['Supplies stocked','Floors clean','Fixtures working'].map((label,i)=>'<label><input type="checkbox" data-check="'+i+'" '+(checks[i]?'checked':'')+'>'+label+'</label>').join('')+'</div><button class="button" id="task-action">'+(completed?'Reset example':started?'Mark complete':'Start task')+'</button><button class="button secondary" id="task-help">I need help</button><p class="sample-result" id="task-result" role="status">'+(completed?'Sample task complete. Ready for the next thing.':started?'Sample task started. Work at your own pace.':'')+'</p></div><div class="app-row"><b>Up next · Restock market</b>'+icon('down')+'</div><div class="notice">'+icon('sun')+'<div><b>Social tonight at 6</b><span>Relevant updates, in the same place.</span></div></div>';
    } else {
      screen.innerHTML = '<h3 class="screen-title">'+(role==='owner'?'Your park today':'Keep the day moving')+'</h3><p class="screen-subtitle">Thursday · Example park</p>'+(role==='owner'?'<div class="metrics"><div><b>'+(helpAssigned?'0':'1')+'</b>needs help</div><div><b>'+(2-verified.size)+'</b>to review</div><div><b>6</b>open tasks</div></div>':'')+'<div class="attention"><h4>Site 8 needs a hose</h4><p>Reported by Alex · Camp Luxury</p><button class="button" id="assign-help">'+(helpAssigned?'Reset example':'Assign help')+'</button><p class="sample-result" role="status">'+(helpAssigned?'Sample assignment: Jordan will bring a hose.':'')+'</p></div><b class="small">Work awaiting review</b><div class="queue">'+['Restock market','Refresh site 12'].map((task,i)=>'<div class="app-row"><span><b>'+task+'</b><small>'+(i?'Jordan':'Sam')+' · Marked complete</small></span><button class="review-button" data-verify="'+i+'">'+(verified.has(i)?'Verified ✓':'Verify')+'</button></div>').join('')+'</div>'+(role==='owner'?'<details class="permission"><summary>People & permissions</summary><label><input type="checkbox" id="manager-access" '+(managerGranted?'checked':'')+'>Give Emily manager access</label><p id="permission-status" role="status">'+(managerGranted?'Example: Emily has manager access.':'Example: Emily has host access.')+'</p><p>Preview only. No real account permissions change.</p></details>':'<div class="app-row"><b>Today’s assignments</b><span>6 staff on site</span></div>');
    }
  }
  document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click',()=>renderRole(button.dataset.role)));
  screen.addEventListener('change',event=>{
    if (event.target.matches('[data-check]')) checks[Number(event.target.dataset.check)] = event.target.checked;
    if (event.target.id==='manager-access') { managerGranted=event.target.checked; document.getElementById('permission-status').textContent='Example: Emily has '+(managerGranted?'manager':'host')+' access.'; }
  });
  screen.addEventListener('click',event=>{
    const target=event.target.closest('button');
    if (!target) return;
    if (target.id==='task-action') {
      if (completed) { completed=false;started=false;checks.fill(false); }
      else if (!started) started=true;
      else if (!checks.every(Boolean)) { document.getElementById('task-result').textContent='Check the three items before completing this sample task.';return; }
      else completed=true;
      renderRole('host');document.getElementById('task-action').focus({preventScroll:true});
    }
    if (target.id==='task-help') document.getElementById('task-result').textContent='Example: “Missing cleaning supplies.” This would become a request for your manager. Nothing was sent.';
    if (target.id==='assign-help') { helpAssigned=!helpAssigned;renderRole(role);document.getElementById('assign-help').focus({preventScroll:true}); }
    if (target.hasAttribute('data-verify')) { const id=Number(target.dataset.verify);verified.has(id)?verified.delete(id):verified.add(id);renderRole(role);screen.querySelector('[data-verify="'+id+'"]').focus({preventScroll:true}); }
  });
  renderRole('host');
  document.getElementById('stock-count').addEventListener('input',event=>{
    const value=event.target.value;
    const n=Number(value);
    const status=document.getElementById('stock-status');
    if (value===''||!Number.isInteger(n)||n<0||n>9999) {status.textContent='Enter a whole count from 0 to 9,999.';status.classList.remove('low');return;}
    status.classList.toggle('low',n<=25);
    status.textContent=n+' on hand · '+(n<=25?'At or below 25: time to reorder.':'Above the reorder point of 25.');
  });
  const slides=Array.from(document.querySelectorAll('.slide'));
  const previous=document.getElementById('previous');
  const next=document.getElementById('next-slide');
  let current=0;
  let frame=false;
  function updateNavigation(){
    const marker=window.innerHeight*.38;
    let nearest=0;
    slides.forEach((slide,index)=>{if(slide.getBoundingClientRect().top<=marker) nearest=index;});
    current=nearest;
    document.getElementById('slide-number').textContent=String(current+1).padStart(2,'0');
    document.getElementById('slide-label').textContent=slides[current].dataset.label;
    document.querySelectorAll('.deck-dots a').forEach((a,index)=>{index===current?a.setAttribute('aria-current','step'):a.removeAttribute('aria-current');});
    previous.disabled=current===0;next.disabled=current===slides.length-1;
    frame=false;
  }
  function go(index){const slide=slides[Math.max(0,Math.min(slides.length-1,index))];slide.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});history.replaceState(null,'','#'+slide.id);}
  previous.addEventListener('click',()=>go(current-1));next.addEventListener('click',()=>go(current+1));
  window.addEventListener('scroll',()=>{if(!frame){frame=true;requestAnimationFrame(updateNavigation);}},{passive:true});
  window.addEventListener('resize',updateNavigation);
  document.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('input,select,textarea,button,a,summary,[contenteditable]'))return;
    if(event.key==='ArrowRight'){event.preventDefault();go(current+1);}
    if(event.key==='ArrowLeft'){event.preventDefault();go(current-1);}
  });
  updateNavigation();
})();

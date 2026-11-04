// A self-contained rehearsal. No registration, storage, push or network writes.
const families={
  chen:{name:'Chen',athlete:'Riley',preference:'Schedule alerts only',alerts:['schedule']},
  parker:{name:'Parker',athlete:'Alex',preference:'All Pep Talk alerts',alerts:['schedule','general']},
  ellis:{name:'Ellis',athlete:'Jordan',preference:'Alerts muted',alerts:[]}
};
const el=id=>document.getElementById(id);
const entries=[];
let moved=false;
function render(){
  const family=families[el('practice-family').value];
  const schedule=moved?'5:00 PM · Community gym':'4:00 PM · North field';
  el('practice-current').textContent=schedule;
  el('practice-family-time').textContent=schedule;
  el('practice-child').textContent=family.athlete+'’s Tuesday practice';
  el('practice-family-heading').textContent=family.name+' family';
  el('practice-pref').textContent=family.preference;
  el('practice-move').disabled=moved;
  el('practice-note').disabled=entries.some(entry=>entry.category==='general');
  const count=entries.filter(entry=>family.alerts.includes(entry.category)).length;
  el('practice-result').textContent=entries.length?'Sample inbox · '+count+' simulated '+(count===1?'alert':'alerts'):'The family is expecting practice at four. Try the coach controls.';
  el('practice-inbox').replaceChildren(...entries.map(entry=>{
    const item=document.createElement('li');
    const result=family.alerts.includes(entry.category)?'Alert shown':'Quiet inbox delivery';
    const label=document.createElement('strong');label.textContent=result;
    item.append(label,document.createTextNode(' · '+entry.body));return item;
  }));
}
function record(category,body){
  entries.unshift({category,body});
  el('practice-status').textContent='Saved in the demo for all three families.';
  render();
}
el('practice-move').onclick=()=>{
  moved=true;
  record('schedule','Tuesday practice moved from 4:00 PM at the north field to 5:00 PM in the community gym.');
};
el('practice-note').onclick=()=>record('general','Bring a water bottle to practice.');
el('practice-family').onchange=render;
el('practice-reset').onclick=()=>{
  entries.length=0;moved=false;el('practice-family').value='chen';
  el('practice-status').textContent='Demo reset. Tuesday practice starts at 4:00 PM.';render();
};
render();

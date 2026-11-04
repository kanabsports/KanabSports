import {visitAlerts} from '/assets/pep-badge.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const role=params.get('role')||'parent',base='/api/pep-audiences?role='+encodeURIComponent(role);
const orgFilter=params.get('org'),teamFilter=params.get('team'),groupFilter=params.get('group');
let channels=[],current=null,pending=null,older=null,loading=0;
const status=text=>$('status').textContent=text;
async function api(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const d=await r.json();if(!r.ok){if(r.status===401&&role==='student')$('signin').hidden=false;throw Error(d.error||'Request unavailable.');}return d;
}
$('back').href=role==='coach'?'/coaches':role==='student'?'/':'/family/';
$('intro').textContent=role==='coach'?'Coaches-only posts reach assigned team staff. A shared family Pep Talk goes to the selected athlete and guardian together.':role==='student'?'Your guardian can read every Pep Talk shown here.':'These are the Pep Talks addressed to you and your athlete together. Private parent conversations are in your separate inbox.';
const label=c=>c.team_name+' · '+(c.enrollment?'Athlete '+c.student_ref+' + guardian':'Coaches only');
async function history(before){
  const serial=++loading,c=current;if(!c)return;
  if(!before){$('history').replaceChildren();older=null;$('older').hidden=true;}
  const q=new URLSearchParams({team:c.team_code,org:c.organization_id,group:c.enrollment});if(before)q.set('before',before);
  try{
    const d=await api(base+'&'+q);
    if(serial!==loading)return;
    const nodes=d.messages.map(m=>{const a=document.createElement('article');a.className='bubble';const name=document.createElement('strong'),body=document.createElement('p'),date=document.createElement('small');name.textContent=m.author_name;date.textContent=new Date(m.created).toLocaleString();body.textContent=m.body;a.append(name,body,date);return a;});
    if(before)$('history').prepend(...nodes);else $('history').replaceChildren(...nodes);
    older=d.older;$('older').hidden=!older;
    $('composer').hidden=role!=='coach';$('revoke').hidden=role!=='parent';
    status(nodes.length?'':'No Pep Talks here yet.');
    await visitAlerts(role==='coach'?'/coach-sw.js':'/messages/sw.js');
  }catch(e){if(serial===loading){$('history').replaceChildren();$('composer').hidden=true;status(e.message);}}
}
function select(index){
  current=channels[index];pending=null;$('message').value='';$('composer').hidden=true;$('revoke').hidden=true;$('audienceText').textContent=current?label(current):'';history().catch(e=>status(e.message));
}
async function open(){
  if(role==='student'&&location.hash){const token=location.hash.slice(1);window.history.replaceState(null,'',location.pathname+location.search);await api('/api/student-pep-access',{action:'redeem',token});}
  const d=await api(base);channels=d.channels;
  $('signin').hidden=true;$('logout').hidden=role!=='student';$('app').hidden=!channels.length;
  if(!channels.length){status('No approved audiences are available for this account.');return;}
  $('channels').replaceChildren(...channels.map((c,i)=>new Option(label(c),String(i))));
  const target=channels.findIndex(c=>(teamFilter===null||c.team_code===teamFilter)&&(orgFilter===null||c.organization_id===orgFilter)&&(groupFilter===null||c.enrollment===groupFilter));
  if(target===-1&&(teamFilter||groupFilter)){status('This audience is no longer available.');$('app').hidden=true;return;}
  $('channels').selectedIndex=Math.max(0,target);select($('channels').selectedIndex);
}
$('channels').onchange=()=>{if($('message').value&&!confirm('Discard this draft and change audience?')){$('channels').selectedIndex=channels.indexOf(current);return;}select($('channels').selectedIndex);};
$('refresh').onclick=()=>history();$('older').onclick=()=>history(older);
$('composer').onsubmit=async e=>{
  e.preventDefault();const c=current,body=$('message').value.trim();if(!c||!body)return;
  if(!pending||pending.body!==body)pending={...c,body,id:crypto.randomUUID()};
  const button=e.submitter;button.disabled=true;$('channels').disabled=true;
  try{await api(base,pending);pending=null;$('message').value='';await history();status('Pep Talk saved.');}catch(e){status(e.message);}finally{button.disabled=false;$('channels').disabled=false;}
};
$('signin').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/student-pep-access',{action:'request',email:$('email').value});status(d.message);}catch(e){status(e.message);}};
$('logout').onclick=async()=>{try{await api('/api/student-pep-access',{action:'logout'});location.reload();}catch(e){status(e.message);}};
$('revoke').onclick=async()=>{if(!current||!confirm('Withdraw consent and close athlete access to this shared audience?'))return;try{await api(base,{action:'withdraw',enrollment:current.enrollment});location.reload();}catch(e){status(e.message);}};
open().catch(e=>status(e.message));

const box=document.getElementById('coachHelp');
const role=box.dataset.role;
const local=id=>box.querySelector('[data-field="'+id+'"]');
const status=text=>{local('status').textContent=text;};
let peer='',pending=null,version=0;
function endpoint(path){return '/api/coach-help?role='+role+(path||'');}
async function request(path,body){
 const response=await fetch(endpoint(path),{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok){if(response.status===401||response.status===403){reset();}throw Error(data.error||'Access unavailable.');}return data;
}
function reset(){
 version++;box.hidden=true;peer='';pending=null;local('draft').value='';local('history').replaceChildren();local('updates')?.replaceChildren();local('peers')?.replaceChildren();status('');
}
function entry(text){const p=document.createElement('p');p.textContent=text;return p;}
async function refresh(){
 const serial=++version;
 try{
  if(role==='parent'){
   const d=await request('');if(serial!==version)return;
   const select=local('peers'),old=peer;
   select.replaceChildren(...d.peers.map(x=>new Option(x.name+' · '+x.team,new URLSearchParams({team:x.team_code,coach:x.id}).toString())));
   if(Array.from(select.options).some(x=>x.value===old))select.value=old;
   peer=select.value;
   if(peer!==old){pending=null;local('draft').value='';}
   box.hidden=false;local('compose').hidden=!peer;
   local('updates').replaceChildren(...(d.updates.length?d.updates.map(m=>entry(m.team+' · '+m.author+' · '+m.body)):[entry('New team announcements appear here after a coach includes you.')]));
   if(!peer){local('history').replaceChildren(entry('No coach conversations yet.'));return;}
  }
  const d=await request(peer?'&'+peer:'');if(serial!==version)return;
  box.hidden=false;local('history').replaceChildren(...(d.messages.length?d.messages.map(m=>entry((m.role==='coach'?'Coach':'Jeff')+' · '+m.body)):[entry('No support notes yet.')]));
  if(role==='coach'){local('invite').hidden=!d.canInvite;local('include').checked=d.included;local('audience').textContent=d.included?'Jeff is on the team announcement list.':'Jeff is available for app help.';}
 }catch(e){if(!box.hidden)status(e.message);}
}
local('compose').onsubmit=async event=>{
 event.preventDefault();const body=local('draft').value.trim();if(!body)return;
 if(!pending||pending.body!==body||pending.peer!==peer)pending={id:crypto.randomUUID(),body,peer};
 const button=event.submitter,select=local('peers');button.disabled=true;if(select)select.disabled=true;
 try{await request(peer?'&'+peer:'',{action:'post',body,id:pending.id});local('draft').value='';pending=null;await refresh();status('Note saved.');}catch(e){status(e.message);}finally{button.disabled=false;if(select)select.disabled=false;}
};
local('refresh').onclick=refresh;
if(role==='coach'){
 local('include').onchange=async e=>{const input=e.target;input.disabled=true;try{await request('',{action:'include',enabled:input.checked});await refresh();}catch(e){input.checked=!input.checked;status(e.message);}finally{input.disabled=false;}};
 document.addEventListener('coachsessionready',refresh);
}else{
 local('peers').onchange=()=>{pending=null;peer=local('peers').value;local('draft').value='';local('history').replaceChildren();refresh();};
 document.addEventListener('pep-parent-session',e=>{reset();if(e.detail)refresh();});
}
refresh();
setInterval(()=>{if(!document.hidden&&!box.hidden&&box.getClientRects().length&&!local('draft').value)refresh();},15000);

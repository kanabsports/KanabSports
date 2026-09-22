const $=id=>document.getElementById(id);
let selected='',state=null,older=null,version=0,busy=false,pending=null;
const drafts=new Map();
const demo=new URLSearchParams(location.search).get('demo')==='1';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(text){$('status').textContent=text}
function signedOut(){version++;state=null;selected='';drafts.clear();pending=null;$('messages').replaceChildren();$('staff').replaceChildren();$('teams').replaceChildren();$('messageForm').reset();$('workspace').hidden=true;$('login').hidden=false}
async function api(data,query=''){
 const r=await fetch('/api/team-messages'+query,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const d=await r.json();if(r.status===401)signedOut();if(!r.ok)throw Error(d.error||'Please try again.');return d;
}
function messageMarkup(m){return '<article class="message"><strong>'+esc(m.sender)+'</strong><time datetime="'+esc(m.created_at.replace(' ','T')+'Z')+'">'+esc(new Date(m.created_at.replace(' ','T')+'Z').toLocaleString())+'</time><p>'+esc(m.body)+'</p></article>'}
function render(data,append=false){state=data;$('login').hidden=true;$('workspace').hidden=false;$('identity').textContent='Signed in as '+data.coach.name;
 $('teams').innerHTML=data.teams.map(t=>'<button class="team-button" data-team="'+esc(t.id)+'" aria-current="'+(t.id===selected)+'">'+esc(t.name)+'</button>').join('')||'<p class="muted">No teams yet. Your head coach can add you using your account email.</p>';
 const team=data.teams.find(t=>t.id===selected);$('empty').hidden=!!team;$('teamPanel').hidden=!team;if(!team)return;
 $('teamName').textContent=team.name;older=data.older;$('older').hidden=!older;
 if(append)$('messages').insertAdjacentHTML('afterbegin',data.messages.map(messageMarkup).join(''));else $('messages').innerHTML=data.messages.map(messageMarkup).join('')||'<p class="muted">No messages yet. Start the conversation.</p>';
 $('staff').innerHTML=data.staff.map(s=>'<div class="staff"><div>'+esc(s.name)+'<small>'+(s.role==='head'?'Head coach':'Assistant coach')+'</small></div>'+(team.role==='head'&&s.role==='assistant'?'<button data-remove="'+esc(s.id)+'" data-name="'+esc(s.name)+'">Remove</button>':'')+'</div>').join('');$('addForm').hidden=team.role!=='head';
}
async function load(append=false){const n=++version;const q=selected?'?team='+encodeURIComponent(selected)+(append&&older?'&before='+older:''):'';try{const d=await api(null,q);if(n!==version)return;if(!selected&&d.teams.length){selected=d.teams[0].id;return load()}render(d,append)}catch(e){if(n!==version)return;if(selected){$('teamPanel').hidden=true;$('messages').replaceChildren();$('staff').replaceChildren();}notice(e.message)}}
async function task(form,fn){if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);notice('');try{await fn()}catch(e){notice(e.message)}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function select(id){if(busy||id===selected)return;drafts.set(selected,$('messageForm').elements.message.value);selected=id;pending=null;$('messageForm').elements.message.value=drafts.get(id)||'';$('teamPanel').hidden=true;notice('');load()}
$('teams').onclick=e=>{const b=e.target.closest('[data-team]');if(b)select(b.dataset.team)};
$('loginForm').onsubmit=e=>{e.preventDefault();task(e.target,async()=>{const f=e.target;const r=await fetch('/api/coach-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',email:f.elements.email.value,password:f.elements.password.value})});const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'Sign in failed.');f.reset();await load()})};
$('logout').onclick=()=>task(null,async()=>{const r=await fetch('/api/coach-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(!r.ok)throw Error('Sign out failed. Try again.');signedOut();notice('Signed out.')});
$('createForm').onsubmit=e=>{e.preventDefault();task(e.target,async()=>{const d=await api({action:'create',name:e.target.elements.name.value});selected=d.teamId;pending=null;$('messageForm').reset();e.target.reset();await load()})};
$('messageForm').onsubmit=e=>{e.preventDefault();task(e.target,async()=>{const text=e.target.elements.message.value.trim();if(!text)throw Error('Write a message first.');if(!pending||pending.text!==text||pending.team!==selected)pending={id:crypto.randomUUID(),text,team:selected};await api({action:'send',teamId:selected,message:text,messageId:pending.id});pending=null;drafts.delete(selected);e.target.reset();await load();notice('Message sent to your coaching staff.');$('messages').scrollTop=$('messages').scrollHeight})};
$('addForm').onsubmit=e=>{e.preventDefault();task(e.target,async()=>{await api({action:'add',teamId:selected,email:e.target.elements.email.value});e.target.reset();await load();notice('Assistant coach added. They can sign in to see this team.')})};
$('staff').onclick=e=>{const b=e.target.closest('[data-remove]');if(!b||!confirm('Remove '+b.dataset.name+' from this team? They will lose access; their messages will remain.'))return;task(null,async()=>{await api({action:'remove',teamId:selected,coachId:b.dataset.remove});await load();notice('Coach access removed.')})};
$('refresh').onclick=()=>{if(!busy){notice('');load()}};$('older').onclick=()=>{if(!busy)load(true)};
// Preserve the reader's place; poll only while reading the latest page.
if(demo){
 selected='demo';
 render({coach:{id:'demo-assistant',name:'Alex · Assistant coach (example)'},teams:[{id:'demo',name:'Example Soccer Team',role:'assistant'}],staff:[{id:'demo-head',name:'Sam · Example head coach',role:'head'},{id:'demo-assistant',name:'Alex · Example assistant coach',role:'assistant'}],older:null,messages:[{id:'example-1',sender:'Sam · Head coach',created_at:'2026-09-22 16:00:00',body:'Can you run warmups at practice today? I will bring the cones.'},{id:'example-2',sender:'Alex · Assistant coach',created_at:'2026-09-22 16:05:00',body:'Absolutely. I will handle warmups and the first passing drill.'}]});
 notice('Read-only design preview · Example team and messages. Nothing here is sent or saved.');
 $('logout').hidden=true;$('refresh').hidden=true;$('createForm').closest('details').hidden=true;
 $('messageForm').elements.message.placeholder='Head and assistant coaches both write here';
 $('messageForm').elements.message.disabled=true;$('messageForm').querySelector('button').disabled=true;
}else{
 setInterval(()=>{if(!document.hidden&&!busy&&selected&&$('login').hidden&&$('messages').scrollTop+$('messages').clientHeight>=$('messages').scrollHeight-30){load()}},15000);
 load();
}

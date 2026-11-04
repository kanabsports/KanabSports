(() => {
  const $=id=>document.getElementById(id);
  const token=new URLSearchParams(location.hash.slice(1)).get('invite');
  if(token)history.replaceState(null,'',location.pathname);
  const status=$('status');
  async function api(body) {
    const response=await fetch('/api/assistant-coaches',body?{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    }:{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Please try again.');
    return data;
  }
  async function busy(container,action) {
    const buttons=container.querySelectorAll('button');
    buttons.forEach(button=>button.disabled=true);
    status.textContent='Working…';
    try{await action()}catch(error){status.textContent=error.message}
    finally{buttons.forEach(button=>button.disabled=false)}
  }
  const labels={sending:'Sending',sent:'Invited',accepted:'Joined',failed:'Email needs attention',expired:'Invitation expired',revoked:'Access removed'};
  async function loadTeam() {
    const data=await api();
    $('intro').textContent=data.team+' · '+data.sport;
    $('management').hidden=false;
    $('invites').replaceChildren();
    if(!data.invites.length)$('invites').textContent='Your assistant coaches will appear here.';
    for(const invite of data.invites) {
      const row=document.createElement('article');row.className='person';
      const name=document.createElement('strong');name.textContent=invite.name;
      const email=document.createElement('p');email.className='muted';email.textContent=invite.email;
      const badge=document.createElement('span');badge.className='badge';badge.textContent=labels[invite.status]||invite.status;
      row.append(name,email,badge);
      if(invite.last_error){const note=document.createElement('p');note.className='muted';note.textContent=invite.last_error;row.append(note)}
      const actions=document.createElement('div');actions.className='actions';
      const controls=[];
      if(['sent','failed','expired'].includes(invite.status))controls.push(['resend','Resend invitation']);
      if(invite.status!=='revoked')controls.push(['revoke',invite.status==='accepted'?'Remove access':'Cancel invitation']);
      for(const [action,label] of controls) {
        const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;
        button.onclick=()=>{
          if(action==='revoke'&&!confirm(label+' for '+invite.name+'?'))return;
          busy(row,async()=>{const result=await api({action,id:invite.id});await loadTeam();status.textContent=result.message});
        };
        actions.append(button);
      }
      row.append(actions);$('invites').append(row);
    }
  }
  $('inviteForm').onsubmit=event=>{
    event.preventDefault();
    busy(event.currentTarget,async()=>{
      const data=await api({action:'invite',name:$('name').value.trim(),email:$('email').value.trim()});
      $('inviteForm').reset();await loadTeam();status.textContent=data.message;
    });
  };
  $('acceptForm').onsubmit=event=>{
    event.preventDefault();
    busy(event.currentTarget,async()=>{
      const data=await api({action:'accept',token,password:$('newPassword').value});
      $('newPassword').value='';status.textContent=data.message;
      // Keep the team-specific sign-in link available when the coach returns.
      try{localStorage.setItem('ksCoachAccountLink','/coach-account.html?coach='+encodeURIComponent(data.coachId)+'&email='+encodeURIComponent(data.email))}catch{}
      location.assign('/coaches.html?welcome=1#coach-tools');
    });
  };
  (async()=>{
    try {
      if(token) {
        $('title').textContent='You’re invited to coach';
        const data=await api({action:'preview',token});
        $('intro').textContent=data.coach+' invited you to '+data.team+' · '+data.sport;
        $('invitedPerson').textContent=data.name+' · '+data.email;
        $('acceptance').hidden=false;
      }else await loadTeam();
    }catch(error){status.textContent=error.message;$('intro').textContent=token?'Ask your lead coach if you need a fresh invitation.':'Open your team with your coach account.';$('signIn').hidden=false}
  })();
})();

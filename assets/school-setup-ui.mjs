import {$,api,table,button,option,dateValue} from './school-ui.mjs';
async function load(){try{const d=await api('/api/school-admin');$('controls').hidden=false;$('athletePilot').hidden=!d.studentPilot;$('status').textContent='Owner access verified.';$('school').replaceChildren();d.schools.forEach(s=>option($('school'),s.id,s.name));$('team').replaceChildren();option($('team'),'','Choose an unassigned team');d.teams.filter(t=>!t.kind).forEach(t=>option($('team'),t.team_code,[t.organization,t.team_name,t.sport,t.team_code].filter(Boolean).join(' · ')));table($('teams'),['Team','Coach selection','Approved type','School'],d.teams.map(t=>[t.team_name||t.team_code,t.requested_kind||'—',t.kind||'Unassigned — messaging locked',d.schools.find(s=>s.id===t.school_id)?.name||'—']));table($('staff'),['School','Email','Role','Expires','Action'],d.staff.map(s=>[d.schools.find(o=>o.id===s.school_id)?.name||s.school_id,s.email,s.role,dateValue(s.expires),s.active?button('Revoke permission',async()=>{if(!confirm('Revoke this permission? Revoking a principal also revokes their delegates.'))return;try{await api('/api/school-admin',{action:'revoke_staff',id:s.id});await load()}catch(e){$('status').textContent=e.message}},'danger'):'Revoked']))}catch(e){$('status').textContent=e.message}}
$('createSchool').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await api('/api/school-admin',{action:'create_school',name:$('schoolName').value,email:$('principalEmail').value,expires:$('principalExpiry').value,evidence:$('principalEvidence').value,confirmed:$('principalConfirmed').checked});$('schoolStatus').textContent=r.message;$('createSchool').reset();await load()}catch(e){$('schoolStatus').textContent=e.message}finally{b.disabled=false}};
$('assignTeam').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/school-admin',{action:'assign_team',team_code:$('team').value,kind:$('kind').value,school_id:$('school').value,evidence:$('teamEvidence').value,confirmed:$('teamConfirmed').checked});$('teamStatus').textContent='Team assigned. School messaging stays locked pending school approval.';$('assignTeam').reset();await load()}catch(e){$('teamStatus').textContent=e.message}finally{b.disabled=false}};load();

$('athleteEnrollment').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter,form=e.currentTarget;
 const data=Object.fromEntries(new FormData(form));button.disabled=true;
 try{await api('/api/school-admin',{...data,action:button.value,confirmed:true,verified_teen:form.elements.verified_teen.checked});$('athleteStatus').textContent=button.value==='enroll_athlete'?'Shared Pep Talks enabled for this family.':'Access withdrawn.';form.reset();}
 catch(error){$('athleteStatus').textContent=error.message;}finally{button.disabled=false;}
};

async function loadTravelPilot(){
 try{
  const d=await api('/api/travel-messaging-setup');
  $('travelPilotStatus').textContent=d.online?'Production private messaging is enabled for enrolled teams.':'Production private messaging is off. Enrollments can be prepared for launch.';
  const select=$('travelPilotCoach');select.replaceChildren(new Option('Choose a coach and team',''));
  for(const c of d.coaches){const o=new Option([c.name,c.team_name||c.organization,c.team_code,c.enrolled?'Enrolled':'Not enrolled'].join(' · '),c.id);o.dataset.code=c.team_code;select.add(o);}
 }catch(e){$('travelPilotStatus').textContent=e.message;}
}
$('travelPilot').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,button=event.submitter,coach=$('travelPilotCoach').selectedOptions[0];
 button.disabled=true;
 try{await api('/api/travel-messaging-setup',{action:button.value,coach_id:coach.value,team_code:coach.dataset.code,confirmed:form.elements.confirmed.checked,evidence:form.elements.evidence.value});form.reset();await loadTravelPilot();$('travelPilotStatus').textContent='Assignment saved. '+$('travelPilotStatus').textContent;}
 catch(e){$('travelPilotStatus').textContent=e.message;}finally{button.disabled=false;}
};
loadTravelPilot();

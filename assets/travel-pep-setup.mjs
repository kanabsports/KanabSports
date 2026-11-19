import {$,api} from './school-ui.mjs';
async function loadTravelPilot(){
 try{
  const d=await api('/api/travel-messaging-setup');
  $('travelPilotStatus').textContent=d.online?'Production private messaging is enabled for enrolled teams.':'Approved travel coaches can turn on Pep Talk in their Coach Portal. Owner enrollments alone are staged while the general pilot is off.';
  const select=$('travelPilotCoach');select.replaceChildren(new Option('Choose a coach and team',''));
  for(const c of d.coaches){const o=new Option([c.name,c.team_name||c.organization,c.team_code,c.role,c.enrolled?'Enrolled':'Not enrolled'].join(' · '),c.id);o.dataset.code=c.team_code;select.add(o);}
 }catch(e){$('travelPilotStatus').textContent=e.message;}
}
$('travelPilot').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,button=event.submitter,coach=$('travelPilotCoach').selectedOptions[0];
 button.disabled=true;
 try{await api('/api/travel-messaging-setup',{action:button.value,coach_id:coach.value,team_code:coach.dataset.code,confirmed:form.elements.confirmed.checked,evidence:form.elements.evidence.value});form.reset();await loadTravelPilot();$('travelPilotStatus').textContent='Assignment saved. '+$('travelPilotStatus').textContent;}
 catch(e){$('travelPilotStatus').textContent=e.message;}finally{button.disabled=false;}
};
loadTravelPilot();

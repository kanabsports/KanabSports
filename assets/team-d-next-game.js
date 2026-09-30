// Dates use the team’s timezone, including on phones traveling outside Utah.
(()=>{
 const node=document.getElementById('teamNextUp');
 if(!node)return;
 const games=[
 ['2026-09-28','6:45 PM','Team B (Rhees Jackson)'],
 ['2026-10-05','6:45 PM','Team A (Amber Hooper)'],
 ['2026-10-12','6:45 PM','Team C (Tami Van Dyke)'],
 ['2026-10-26','6:00 PM','Team B (Rhees Jackson)'],
 ['2026-11-02','6:45 PM','Team A (Amber Hooper)']
 ];
 function render(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>parts.find(p=>p.type===k).value;
 const today=part('year')+'-'+part('month')+'-'+part('day');
 const next=games.find(g=>g[0]>=today);
 node.replaceChildren();
 if(!next){node.textContent='No upcoming games scheduled.';return;}
 const title=document.createElement('strong');
 title.textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'long',month:'long',day:'numeric'}).format(new Date(next[0]+'T12:00:00-07:00'))+' · '+next[1];
 const opponent=document.createElement('div');opponent.className='muted';opponent.textContent='vs '+next[2];node.append(title,opponent);
 }
 render();document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
})();

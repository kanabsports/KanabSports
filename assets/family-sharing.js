import {createDriverPlans} from './family-drivers.js';
export function mountFamilySharing(container,account){
 let schedules=[];const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const driver=createDriverPlans({events:()=>schedules.flatMap(s=>s.events.map(e=>({s:{code:s.code,owner_email:s.owner,can_edit:s.can_edit},t:{name:s.name},e}))),render:draw,account,shared:true});
 function draw(){container.replaceChildren();const link=node('a','Trusted people, personal codes & invitations →');link.href='/family/access/';container.append(link);for(const s of schedules){const article=node('article',''),heading=node('h3',s.owner_name+' · '+s.name);article.append(heading,node('p',(s.can_edit?'Can edit driver plans':'View only')+(s.is_driver?' · Driver':'')));for(const e of s.events){const row=node('div','');row.append(node('p',e.date+' · '+e.time+' · '+e.title+(e.cancelled?' · CANCELLED':'')));if(!e.cancelled){const controls=document.createElement('div');controls.innerHTML=driver.markup({code:s.code,owner_email:s.owner,can_edit:s.can_edit},e);row.append(controls);}article.append(row);}container.append(article);}}
 async function load(){if(!account()){schedules=[];draw();return;}try{const r=await fetch('/api/family-sharing',{cache:'no-store'});if(!r.ok){schedules=[];draw();return;}schedules=(await r.json()).schedules;await driver.load();draw();}catch{container.replaceChildren(node('p','Shared schedules could not refresh.'));}}
 draw();return {load};
}

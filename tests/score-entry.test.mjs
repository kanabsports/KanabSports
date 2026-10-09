import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the production page script, including its actual rendered-row click handler.
// All API calls are intercepted; no real scores or invitations are created.
const source=readFileSync(new URL('../score-assistant/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const alerts=[],posts=[];
let scores=['2','1'];
const button={dataset:{send:'0'},disabled:false,textContent:'Submit'};
const elements=new Map();
for(const id of ['form','status','context','mode','games','accept','date','opponent','result','link','details'])elements.set(id,{hidden:false,textContent:'',value:'',addEventListener(type,fn){this[type]=fn},reset(){},querySelector(){return button}});
const games=elements.get('games');
games.querySelectorAll=()=>[button];
games.querySelector=()=>({querySelector(selector){return {value:selector==='[data-us]'?scores[0]:scores[1]}}});
const state={success:true,assistant:{name:'Synthetic Assistant',status:'accepted',trusted:true},coach:{name:'Synthetic Coach',organization:'Synthetic Team',sport:'Swimming'},games:[{date:'2026-10-17',opponent:'Synthetic Meet',status:'open'}]};
const context=vm.createContext({URLSearchParams,location:{search:'?token=synthetic'},document:{getElementById(id){return elements.get(id)}},alert(message){alerts.push(message)},fetch:async(url,options)=>{if(options?.method==='POST'){posts.push(JSON.parse(options.body));return Response.json({success:true,message:'Synthetic submission accepted'})}return Response.json(state)}});
vm.runInContext(source,context);
// Flush the async page load through the event loop.
await new Promise(resolve=>setImmediate(resolve));
assert.equal(typeof button.onclick,'function');
button.onclick();await new Promise(resolve=>setImmediate(resolve));
assert.equal(posts.length,1);assert.equal(posts[0].result,'2-1');assert.equal(posts[0].opponent,'Synthetic Meet');
for(const pair of [['0','0'],['12','105'],[' 2 ',' 1 ']]){scores=pair;button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(posts.at(-1).result,pair.map(v=>v.trim()).join('-'))}
for(const pair of [['','1'],['2',''],['-1','2'],['2.5','1'],['two','1']]){const before=posts.length;scores=pair;button.onclick();assert.equal(posts.length,before);assert.equal(alerts.at(-1),'Enter both final scores.')}
// Exercise the manual-entry form without relying on browser named globals.
for(const [id,value] of Object.entries({date:'2026-10-18',opponent:'Synthetic Other Meet',result:'3-2',link:'',details:'Synthetic test'}))elements.get(id).value=value;
await elements.get('form').submit({preventDefault(){}});
assert.equal(posts.at(-1).date,'2026-10-18');assert.equal(posts.at(-1).result,'3-2');
console.log('PASS: actual page Submit handler accepts 2–1, zero scores, multi-digit scores and trimmed input; invalid scores do not call API; manual form uses explicit fields. All submissions mocked.');

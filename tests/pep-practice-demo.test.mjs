import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const page=await readFile(new URL('../pep/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../pep/practice-demo.js',import.meta.url),'utf8');
const fields=new Map();
function node(){return {textContent:'',children:[],append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children;}};}
const document={
  getElementById(id){
    assert(page.includes('id="'+id+'"'),id+' must exist in the published page');
    if(!fields.has(id))fields.set(id,node());return fields.get(id);
  },
  createElement:node,
  createTextNode:text=>({textContent:text})
};
const el=id=>document.getElementById('practice-'+id);
el('family').value='chen';
vm.runInNewContext(script,{document});
assert.match(page,/data-go="practice">Try a practice change/);
assert.match(page,/href="\/coach-register">Register as a coach/);
assert.equal(el('family-time').textContent,'4:00 PM · North field');
el('note').onclick();el('move').onclick();
for(const [id,alerts,shown] of [['chen',1,['Alert shown','Quiet inbox delivery']],['parker',2,['Alert shown','Alert shown']],['ellis',0,['Quiet inbox delivery','Quiet inbox delivery']]]){
  el('family').value=id;el('family').onchange();
  assert.equal(el('family-time').textContent,'5:00 PM · Community gym');
  assert.match(el('result').textContent,new RegExp(alerts+' simulated alerts'));
  assert.deepEqual(el('inbox').children.map(x=>x.children[0].textContent),shown);
}
el('reset').onclick();assert.equal(el('family').value,'chen');assert.deepEqual(el('inbox').children,[]);
assert.equal(el('move').disabled,false);assert.equal(el('note').disabled,false);
console.log('PASS fictional practice rehearsal, three independent family alert preferences, reset and real signup link.');

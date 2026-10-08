export const $=id=>document.getElementById(id);
export async function api(url,body){const r=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');return d}
export function table(target,headers,rows){target.replaceChildren();const t=document.createElement('table'),head=document.createElement('tr');headers.forEach(h=>{const th=document.createElement('th');th.textContent=h;head.append(th)});t.append(head);rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(v=>{const td=document.createElement('td');if(v instanceof Node)td.append(v);else td.textContent=v??'';tr.append(td)});t.append(tr)});target.append(t)}
export function button(text,fn,kind='secondary'){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=kind;b.onclick=fn;return b}
export function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}
export function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function dateValue(ms){return new Date(ms).toISOString().slice(0,10)}

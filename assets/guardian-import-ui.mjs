import {HEADERS,parseRosterCSV,validateRosterRows} from './guardian-import.mjs';
const $=id=>document.getElementById(id);let preview=[],revision=0;
function clear(){revision++;preview=[];$('rosterFile').value='';$('rosterPreview').replaceChildren();$('importConfirm').checked=false;$('saveRoster').disabled=true;}
$('rosterFile').onchange=async()=>{const version=++revision;preview=[];$('saveRoster').disabled=true;$('rosterPreview').replaceChildren();$('importConfirm').checked=false;try{const file=$('rosterFile').files[0];if(!file)return;if(file.size>100000)throw Error('Use a CSV smaller than 100 KB.');const text=await file.text();if(version!==revision)return;preview=validateRosterRows(parseRosterCSV(text));showPreview(preview);}catch(e){preview=[];$('importStatus').textContent=e.message}};
function showPreview(rows){const columns=rows.some(row=>row.player)?['player','guardian',...HEADERS]:HEADERS;
const table=document.createElement('table');table.style.cssText='width:100%;font-size:14px;text-align:left';const header=document.createElement('tr');for(const name of columns){const th=document.createElement('th');th.textContent=name;header.append(th)}table.append(header);for(const row of rows){const tr=document.createElement('tr');for(const name of columns){const td=document.createElement('td');td.textContent=row[name]||'';tr.append(td)}table.append(tr)}$('rosterPreview').append(table);$('importStatus').textContent=preview.length+' guardian matches ready to verify. No access has been granted.';}
async function sourceData(query=''){
 const r=await fetch('/api/season-rosters?view=owner'+query,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);return d;
}
const select=$('approvedSource'),expiry=$('rosterExpiry');
select.onchange=expiry.onchange=clear;
$('loadApprovedSource').onclick=async()=>{
 clear();const version=revision,id=select.value,end=expiry.value;
 if(!id||!end){$('importStatus').textContent='Choose an approved roster and an expiry date first.';return;}
 try{
  const {roster,players}=await sourceData('&id='+encodeURIComponent(id));if(version!==revision||select.value!==id||expiry.value!==end||$('rosterFile').files.length)return;
  const labels=[],rows=[];
  for(const p of players){for(const g of p.guardians){if(g.email){rows.push({email:g.email,student_ref:p.student_ref,team_code:roster.team_code,season:roster.season,expires:end});labels.push({player:p.student_name,guardian:g.name||''});}}}
  preview=validateRosterRows(rows);
  showPreview(preview.map((row,i)=>({...row,...labels[i]})));
 }catch(e){$('importStatus').textContent=e.message;}
};
sourceData().then(({rosters})=>{for(const r of rosters)select.add(new Option(r.team+' · '+r.season,r.document_id));}).catch(e=>{$('importStatus').textContent=e.message;});
$('importConfirm').onchange=()=>{$('saveRoster').disabled=!preview.length||!$('importConfirm').checked};
$('clearRoster').onclick=()=>{clear();$('importStatus').textContent='Preview cleared. The original file on your device has not been changed.'};
$('saveRoster').onclick=async()=>{if(!preview.length||!$('importConfirm').checked)return;$('saveRoster').disabled=true;try{const r=await fetch('/api/guardian-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:preview,evidence:$('importEvidence').value,confirmed:true})});const d=await r.json();if(!r.ok)throw Error(d.error);clear();$('importStatus').textContent=d.imported+' access records saved; '+d.skipped+' existing records skipped. No source file was uploaded. No invitation messages were sent. Refresh to see the memberships.';}catch(e){$('importStatus').textContent=e.message;$('saveRoster').disabled=false}};
$('downloadRosterTemplate').onclick=()=>{const blob=new Blob([HEADERS.join(',')+'\r\n'],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pep-guardian-roster-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
window.addEventListener('pagehide',clear);

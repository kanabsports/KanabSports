import {validCoachFile,coachFileType} from './coach-file.mjs';
import {$,api,table} from './school-ui.mjs';
import {parseCSV,validateStudents} from './school-roster.mjs';
let current,preview=[],generation=0;
async function load(){try{current=await api('/api/school-roster');$('controls').hidden=false;$('status').textContent='Signed in · '+current.team.school_name;$('teamName').textContent=current.team.team_code+' · '+(current.team.season||'New roster');$('gate').textContent=current.gate.allowed?'School-approved contacts are active.':current.gate.reason;$('season').value=current.team.season||'';$('schoolYear').value=current.team.school_year||'';$('expires').value=current.team.expires||'';table($('current'),['Pep Student ID','Student name'],current.students.map(s=>[s.student_ref,s.student_name]))}catch(e){$('status').textContent=e.message+' Open the Coach Portal to sign in or obtain your team code.'}}
let sourceUrl='';
function resetPreview(){
 preview=[];$('preview').replaceChildren();$('confirmed').checked=false;$('submit').disabled=true;
}
function clearSource(){
 if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl='';
 $('sourceRoster').removeAttribute('href');$('manualRoster').hidden=true;$('playerNames').value='';
}
function clear(){generation++;clearSource();resetPreview();$('rosterFile').value=''}
function showStudents(rows){
 preview=validateStudents(rows,{allowBlankRefs:true});
 table($('preview'),['Pep Student ID','Student name'],preview.map(s=>[s.student_ref||'Pep creates this when submitted',s.student_name]));
 $('uploadStatus').textContent=preview.length+' students ready for review.';
}
$('rosterFile').onchange=async()=>{
 clearSource();resetPreview();const version=++generation;
 try{
  const file=$('rosterFile').files[0];if(!file)return;
  const type=coachFileType(file.name);
  if(type==='text/csv'){
   if(file.size>100000)throw Error('Use a CSV under 100 KB.');
   const text=await file.text();if(version===generation)showStudents(parseCSV(text,['student_ref','student_name']));
  }else{
   if(file.size>5*1024*1024)throw Error('Use a file up to 5 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer());if(version!==generation)return;
   if(!validCoachFile(file.name,bytes))throw Error('Choose a valid PDF, JPG, PNG, or WebP.');
   sourceUrl=URL.createObjectURL(new Blob([bytes],{type}));
   $('sourceRoster').href=sourceUrl;$('manualRoster').hidden=false;
   $('uploadStatus').textContent='Review the selected document and enter the names for school approval.';
  }
 }catch(e){if(version===generation)$('uploadStatus').textContent=e.message}
};
$('playerNames').oninput=resetPreview;
$('previewNames').onclick=()=>{
 resetPreview();
 try{showStudents($('playerNames').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(student_name=>({student_name})));}
 catch(e){$('uploadStatus').textContent=e.message}
};
$('confirmed').onchange=()=>{$('submit').disabled=!preview.length||!$('confirmed').checked};
$('clear').onclick=()=>{clear();$('uploadStatus').textContent='Preview cleared.'};
$('submit').onclick=async()=>{if(!preview.length||!$('confirmed').checked)return;$('submit').disabled=true;try{const r=await api('/api/school-roster',{rows:preview,season:$('season').value,school_year:$('schoolYear').value,expires:$('expires').value,revision:current.team.revision,confirmed:true});clear();try{sessionStorage.setItem('pepCoachReturnMessage',r.message)}catch{}location.assign('/coaches.html#coach-tools')}catch(e){$('uploadStatus').textContent=e.message;$('submit').disabled=false}};
window.addEventListener('pagehide',clear);load();

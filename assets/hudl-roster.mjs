import {csvRows} from './coach-csv.mjs';
const aliases={jerseynumber:'jersey',uniformnumber:'jersey',number:'jersey',graduationyear:'classyear',gradyear:'classyear',position:'position1',primaryposition:'position1',emailaddress:'email'};
const canonical=header=>aliases[header]||header;
function cell(value){
 const safe=/^[=+@-]/.test(value)?"'"+value:value;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function mapRoster(source,target){
 const roster=csvRows(source),template=csvRows(target);
 if(!roster.rows.length)throw Error('Choose a season roster CSV containing players.');
 const sourceFields=roster.headers.map(canonical),fields=template.headers.map(canonical);
 if(!['firstname','lastname'].every(name=>fields.includes(name)&&sourceFields.includes(name)))throw Error('Both files need first name and last name headings. Choose the Hudl roster template.');
 const indices=fields.map(name=>sourceFields.indexOf(name));
 const missing=template.originalHeaders.filter((_,i)=>indices[i]<0||roster.rows.some(row=>!row[indices[i]]));
 const data=roster.rows.map(row=>indices.map(index=>row[index]||''));
 return {csv:[template.originalHeaders,...data].map(row=>row.map(cell).join(',')).join('\r\n'),missing};
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);let previous;
 $('hudlForm').onsubmit=async e=>{
  e.preventDefault();$('hudlDownload').hidden=true;if(previous)URL.revokeObjectURL(previous);
  try{
   const files=[$('sourceRoster').files[0],$('targetRoster').files[0]];
   if(files.some(f=>!f||f.size>5*1024*1024))throw Error('Choose two CSV files under 5 MB each.');
   const [source,template]=await Promise.all(files.map(f=>f.text()));
   const {csv,missing}=mapRoster(source,template);
   previous=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));$('hudlDownload').href=previous;$('hudlDownload').hidden=false;
   $('exportStatus').textContent=missing.length?'Review these empty fields before importing into Hudl: '+missing.join(', '):'Roster prepared in your template’s column order.';
  }catch(err){$('exportStatus').textContent=err.message}
 };
}

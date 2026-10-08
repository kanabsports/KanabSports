// CSV import is local. Only validated rows are submitted to the server.
export const FORM_LABELS={row_number:'Row (leave as is)',student_ref:'Pep Student ID (Pep fills this - do not edit)',student_name:'Student full name (check spelling)',email:'Parent or guardian email (school fills this)',team_code:'Team code (Pep fills this - do not edit)',season:'Season (Pep fills this - do not edit)',expires:'Access end date YYYY-MM-DD (Pep fills this - do not edit)'};
const aliases=new Map(Object.entries(FORM_LABELS).map(([key,label])=>[label.toLowerCase(),key]));
export function parseCSV(text,headers){
 if(typeof text!=='string'||text.length>100000)throw Error('Use a CSV smaller than 100 KB.');
 text=text.replace(/^\uFEFF/,'');
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
  if(c==='"'){if(field||closed)throw Error('Invalid CSV quotes.');quoted=true;continue}
  if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(row.some(v=>v.trim()))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++}continue}
  if(closed)throw Error('Unexpected text after CSV quote.');field+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote.');row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 const found=(rows.shift()||[]).map((v,i)=>(i===0?v.replace(/^\uFEFF/,''):v).trim()).map(v=>aliases.get(v.toLowerCase())||v.toLowerCase());
 const fields=found.filter(h=>h!=='row_number');
 if(found.filter(h=>h==='row_number').length>1||fields.length!==headers.length||new Set(fields).size!==headers.length||headers.some(h=>!fields.includes(h)))throw Error('Please use the downloaded Pep template. Required fields: '+headers.map(h=>FORM_LABELS[h]||h).join(', '));
 const parsed=rows.map((r,i)=>{if(r.length!==found.length)throw Error('Wrong column count on row '+(i+2));return Object.fromEntries(found.map((h,n)=>[h,r[n].trim()]).filter(([h])=>h!=='row_number'))}).filter(r=>Object.values(r).some(v=>v));
 if(!parsed.length||parsed.length>100)throw Error('Fill in between 1 and 100 rows. Blank entry lines are ignored.');
 return parsed;
}
export function validateStudents(rows,{allowBlankRefs=false}={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Use 1–100 students.');const seen=new Set();
 return rows.map(r=>{if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['student_ref','student_name'].includes(k)))throw Error('Only student_ref and student_name are accepted.');const ref=String(r.student_ref||'').trim(),name=String(r.student_name||'').trim();if((!ref&&!allowBlankRefs)||ref.length>100||!name||name.length>120||/[\u0000-\u001f]/.test(ref+name))throw Error('Every student needs a name. Leave the Pep Student ID blank for Pep to create it.');if(ref&&seen.has(ref))throw Error('Duplicate Pep Student ID: '+ref);if(ref)seen.add(ref);return {student_ref:ref,student_name:name}});
}
export function csvText(headers,rows,{friendly=false,blankRows=0,numbered=false}={}){
 const cols=numbered?['row_number',...headers]:headers;
 const values=[...rows,...Array.from({length:blankRows},()=>({}))].map((r,i)=>cols.map(h=>h==='row_number'?i+1:r[h]??''));
 return '\uFEFF'+[friendly?cols.map(h=>FORM_LABELS[h]||h):cols,...values].map(r=>r.map(v=>{const s=String(v);if(/^[=+@\-\t\r]/.test(s))throw Error('Spreadsheet formula-like values are not allowed in downloads.');return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n')+'\r\n';
}

// CSV import is local. Only validated rows are submitted to the server.
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
 const found=(rows.shift()||[]).map((v,i)=>(i===0?v.replace(/^\uFEFF/,''):v).trim());
 if(found.length!==headers.length||new Set(found).size!==headers.length||headers.some(h=>!found.includes(h)))throw Error('Use exactly these columns: '+headers.join(', '));
 if(!rows.length||rows.length>100)throw Error('Use 1–100 rows per team.');
 return rows.map((r,i)=>{if(r.length!==found.length)throw Error('Wrong column count on row '+(i+2));return Object.fromEntries(found.map((h,n)=>[h,r[n].trim()]))});
}
export function validateStudents(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Use 1–100 students.');const seen=new Set();
 return rows.map(r=>{if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['student_ref','student_name'].includes(k)))throw Error('Only student_ref and student_name are accepted.');const ref=String(r.student_ref||'').trim(),name=String(r.student_name||'').trim();if(!ref||ref.length>100||!name||name.length>120||/[\u0000-\u001f]/.test(ref+name))throw Error('Every student needs a reference and name.');if(seen.has(ref))throw Error('Duplicate student reference: '+ref);seen.add(ref);return {student_ref:ref,student_name:name}});
}
export function csvText(headers,rows){return '\uFEFF'+[headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(r=>r.map(v=>{const s=String(v);if(/^[=+@\-\t\r]/.test(s))throw Error('Spreadsheet formula-like values are not allowed in downloads.');return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n')+'\r\n'}

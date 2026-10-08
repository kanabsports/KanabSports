export const HEADERS=['email','student_ref','team_code','season','expires'];
export function parseRosterCSV(text){
 if(text.length>100000)throw Error('Use a CSV smaller than 100 KB.');
 let rows=[],row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('Invalid CSV quotes.');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}continue;}
  if(closed)throw Error('Unexpected text after quoted field.');field+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const headers=(rows.shift()||[]).map((x,i)=>x.replace(i===0?/^\uFEFF/:/$^/,'').trim().toLowerCase());
 if(headers.length!==HEADERS.length||new Set(headers).size!==HEADERS.length||HEADERS.some(h=>!headers.includes(h)))throw Error('Use only these five columns: '+HEADERS.join(', ')+'.');
 if(!rows.length||rows.length>100)throw Error('Import between 1 and 100 guardian/team rows at a time.');
 return rows.map((values,i)=>{if(values.length!==headers.length)throw Error('Row '+(i+2)+' has the wrong number of columns.');return Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));});
}
export function validateRosterRows(rows,now=Date.now()){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Import between 1 and 100 rows.');
 const seen=new Set();return rows.map((r,i)=>{
  if(!r||Object.keys(r).some(k=>!HEADERS.includes(k)))throw Error('Unexpected fields on row '+(i+2)+'.');
  const email=String(r.email||'').trim().toLowerCase(),student_ref=String(r.student_ref||'').trim(),team_code=String(r.team_code||'').trim().toUpperCase(),season=String(r.season||'').trim(),expires=String(r.expires||'').trim(),end=Date.parse(expires+'T00:00:00Z');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!student_ref||student_ref.length>100||!/^KS-[A-Z0-9_-]{1,29}$/.test(team_code)||!season||season.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(expires)||!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==expires||end<=now||end>now+366*86400000)throw Error('Check email, student reference, team code, season and expiry on row '+(i+2)+'. Expiry must be within one year.');
  const key=JSON.stringify([email,student_ref,team_code,season]);if(seen.has(key))throw Error('Duplicate guardian/team/student/season on row '+(i+2)+'.');seen.add(key);
  return {email,student_ref,team_code,season,expires};
 });
}

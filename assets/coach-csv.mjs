export function csvRows(text){
 if(typeof text!=='string'||text.length>5*1024*1024)throw Error('Use a CSV smaller than 5 MB.');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}if(c==='"'){if(field||closed)throw Error('Invalid CSV quotes.');quoted=true;continue}if(c===','||c==='\n'||c==='\r'){row.push(field.trim());field='';closed=false;if(c!==','){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++}continue}if(closed)throw Error('Unexpected text after a CSV quote.');field+=c}
 if(quoted)throw Error('Unclosed CSV quote.');row.push(field.trim());if(row.some(Boolean))rows.push(row);
 const headers=(rows.shift()||[]).map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,''));if(!headers.length)throw Error('The CSV needs column headings.');
 if(rows.some(r=>r.length!==headers.length))throw Error('A row has the wrong number of columns. Save the file as CSV and try again.');
 return {headers,rows};
}
const value=(headers,row,...names)=>{const i=headers.findIndex(h=>names.includes(h));return i<0?'':row[i]||''};
export function parseCoachRoster(text){
 const {headers,rows}=csvRows(text),out=[];
 for(const row of rows){const get=(...names)=>value(headers,row,...names),name=get('playername','studentname','studentfullname','studentfullnamecheckspelling','name','athletename');
 if(!name){if(row.some((v,i)=>v&&!['index','rownumber','rowleaveasis',''].includes(headers[i])))throw Error('Each roster row needs a Player Name or Student name.');continue}
 const guardians=[];
 for(const n of [1,2]){const email=get('guardian'+n+'email',...(n===1?['email','parentemail','guardianemail','parentorguardianemailschoolfillsthis']:[])).toLowerCase(),guardianName=get('parentguardian'+n,'guardian'+n+'name'),phone=get('guardian'+n+'phone');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Check the guardian email for '+name+'.');if(email||guardianName||phone)guardians.push({name:guardianName.slice(0,120),email:email.slice(0,254),phone:phone.slice(0,40)})}
 out.push({student_ref:get('studentref','pepstudentid','pepstudentidpepfillsthisdonotedit').slice(0,100),student_name:name.slice(0,120),grade:get('grade').slice(0,30),guardians});
 }
 if(!out.length||out.length>100)throw Error('Upload 1–100 players. Use the Player Name or Student name column.');return out;
}
export function parseCoachSchedule(text){
 const {headers,rows}=csvRows(text),out=[],seen=new Set();
 for(const row of rows){const get=(...names)=>value(headers,row,...names),raw=get('date','gamedate','eventdate'),opponent=get('opponent','team','opponentteam','event','eventname','meet');
 if(!raw&&!opponent){if(row.some((v,i)=>v&&!['index','rownumber','rowleaveasis',''].includes(headers[i])))throw Error('Each schedule row needs Date and Opponent / Event.');continue}
 let date=raw;const m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)date=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
 const stamp=Date.parse(date+'T00:00:00Z');if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date||!opponent)throw Error('Every event needs a valid date (YYYY-MM-DD or MM/DD/YYYY) and opponent / event name.');
 const key=date+'|'+opponent.toLowerCase();if(seen.has(key))throw Error('Duplicate event: '+date+' '+opponent);seen.add(key);
 const home=get('homeaway'),location=get('location','site');out.push({date,opponent:opponent.slice(0,120),time:get('time','gametime','starttime').slice(0,40),site:[home,location].filter(Boolean).join(' · ').slice(0,240)});
 }
 if(!out.length||out.length>100)throw Error('Upload 1–100 events with Date and Opponent / Event columns.');return out;
}

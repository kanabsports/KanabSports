import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCSV,validateStudents,csvText} from '../assets/school-roster.mjs';
for(const file of ['pep-coach-roster-template.csv','pep-school-contact-form.csv']){
 const csv=readFileSync(new URL('../downloads/'+file,import.meta.url),'utf8');
 assert.equal(csv.trim().split(/\r?\n/).length,41,'Forty visible numbered entry rows');
 assert.match(csv,/school fills this|check spelling/);
}
const rows=[{student_ref:'',student_name:'Example Student'}];
const csv=csvText(['student_name','student_ref'],rows,{friendly:true,numbered:true,blankRows:39});
assert.deepEqual(validateStudents(parseCSV(csv,['student_ref','student_name']),{allowBlankRefs:true}),rows);
assert.throws(()=>validateStudents(rows),'Blank IDs are allowed only on the pending coach roster');
assert.deepEqual(parseCSV('student_ref,student_name\nexisting-id,Example Student',['student_ref','student_name']),[{student_ref:'existing-id',student_name:'Example Student'}],'Older templates remain supported');
assert.throws(()=>parseCSV('student_ref,student_name,DOB\na,b,2000',['student_ref','student_name']));
console.log('PASS: numbered entry lines, readable headers, blank rows ignored, automatic-ID inputs and older template compatibility.');

export const normalizedStudentName=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export async function identitySuggestions(db,team){
 const current=(await db.prepare('SELECT student_ref,student_name FROM school_rosters WHERE team_code=? AND revision=?').bind(team.team_code,team.revision).all()).results||[];
 const previous=(await db.prepare('SELECT student_ref,student_name,group_concat(DISTINCT sport) sports FROM school_verified_contacts WHERE school_id=? GROUP BY student_ref,student_name').bind(team.school_id).all()).results||[];
 const existing=new Set(current.map(r=>r.student_ref));
 return current.filter(r=>!previous.some(p=>p.student_ref===r.student_ref)).map(r=>({...r,candidates:previous.filter(p=>!existing.has(p.student_ref)&&normalizedStudentName(p.student_name)===normalizedStudentName(r.student_name))})).filter(r=>r.candidates.length);
}

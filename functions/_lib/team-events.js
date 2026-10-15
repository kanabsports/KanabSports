import {pilotSchema} from './pilot-schema.js';
export async function teamEvents(db,code,includeCancelled=false){
    const latest=await db.prepare(`
      SELECT g.source_document_id
      FROM coach_schedule_games g
      JOIN coach_documents d ON d.id=g.source_document_id
      JOIN coach_access_requests c ON c.id=g.coach_id
      WHERE c.team_code=? AND d.status='approved'
      ORDER BY datetime(COALESCE(d.reviewed_at,d.created_at)) DESC
      LIMIT 1
    `).bind(code).first();

    let events=[];
    if(latest?.source_document_id){
      const rows=(await db.prepare(`
        SELECT g.id,g.date,g.opponent,g.time,g.site
        FROM coach_schedule_games g
        JOIN coach_access_requests c ON c.id=g.coach_id
        WHERE c.team_code=? AND g.source_document_id=?
        ORDER BY g.date
      `).bind(code,latest.source_document_id).all()).results||[];
      events=rows.map(r=>({
        id:r.id,date:r.date,endDate:r.date,time:r.time||'TBA',
        title:'Game vs '+r.opponent,detail:[r.site,r.opponent].filter(Boolean).join(' · '),
        type:'game',url:'/'
      }));
    }


 await pilotSchema(db);const changes=(await db.prepare('SELECT event_id,event_json FROM pep_event_changes WHERE team_code=?').bind(code).all()).results||[];const map=new Map(events.map(e=>[e.id,e]));for(const row of changes)map.set(row.event_id,JSON.parse(row.event_json));return [...map.values()].filter(e=>includeCancelled||!e.cancelled).sort((a,b)=>a.date.localeCompare(b.date));
}

import {scheduleSchema} from './team-schedule.js';
import {pilotSchema} from './pilot-schema.js';
export async function teamEvents(db,code,includeCancelled=false){
    await scheduleSchema(db);
    const latest=await db.prepare(`
      SELECT g.source_document_id
      FROM coach_schedule_games g
      JOIN coach_documents d ON d.id=g.source_document_id
      JOIN coach_access_requests c ON c.id=g.coach_id
      WHERE c.team_code=? AND c.status='approved' AND d.status='approved'
      ORDER BY datetime(COALESCE(d.reviewed_at,d.created_at)) DESC
      LIMIT 1
    `).bind(code).first();

    let events=[];
    if(latest?.source_document_id){
      const rows=(await db.prepare(`
        SELECT g.id,g.date,g.opponent,g.time,g.site
        FROM coach_schedule_games g
        JOIN coach_access_requests c ON c.id=g.coach_id
        WHERE c.team_code=? AND c.status='approved' AND g.source_document_id=?
        ORDER BY g.date
      `).bind(code,latest.source_document_id).all()).results||[];
      events=rows.map(r=>({
        id:r.id,date:r.date,endDate:r.date,time:r.time||'TBA',
        title:'Game vs '+r.opponent,detail:[r.site,r.opponent].filter(Boolean).join(' · '),
        type:'game',url:'/'
      }));
    }


 await pilotSchema(db);const changes=(await db.prepare('SELECT event_id,event_json FROM pep_event_changes WHERE team_code=?').bind(code).all()).results||[];const map=new Map(events.map(e=>[e.id,e]));for(const row of changes)map.set(row.event_id,JSON.parse(row.event_json));const overrides=(await db.prepare('SELECT * FROM team_schedule_changes WHERE team_code=?').bind(code).all()).results||[];for(const [id,event] of map){const c=overrides.find(x=>x.event_id===id);map.set(id,c?{...event,date:c.date,endDate:c.date,time:c.time,title:c.title,detail:c.detail,cancelled:!!c.cancelled,revision:c.revision,updated:c.updated}:{...event,revision:0});}return [...map.values()].filter(e=>includeCancelled||!e.cancelled).sort((a,b)=>a.date.localeCompare(b.date));
}

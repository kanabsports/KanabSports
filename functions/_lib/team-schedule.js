import {pilotSchema} from './pilot-schema.js';
import {teamEvents} from './team-events.js';
import {driverScheduleTriggers} from './driver-reminders.js';
export async function scheduleSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS team_schedule_changes(team_code TEXT NOT NULL,event_id TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,cancelled INTEGER NOT NULL,revision INTEGER NOT NULL,actor_id TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(team_code,event_id))`).run();await driverScheduleTriggers(db);await pilotSchema(db);
 for(const op of ['INSERT','UPDATE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS pep_practice_schedule_${op.toLowerCase()} AFTER ${op} ON pep_event_changes BEGIN
 INSERT INTO team_schedule_changes(team_code,event_id,date,time,title,detail,cancelled,revision,actor_id,updated)
 VALUES(NEW.team_code,NEW.event_id,json_extract(NEW.event_json,'$.date'),json_extract(NEW.event_json,'$.time'),json_extract(NEW.event_json,'$.title'),json_extract(NEW.event_json,'$.detail'),COALESCE(json_extract(NEW.event_json,'$.cancelled'),0),NEW.version,'practice-workflow',NEW.updated)
 ON CONFLICT(team_code,event_id) DO UPDATE SET date=excluded.date,time=excluded.time,title=excluded.title,detail=excluded.detail,cancelled=excluded.cancelled,revision=team_schedule_changes.revision+1,actor_id=excluded.actor_id,updated=excluded.updated;
 END`).run();
}
export async function scheduleEvents(db,code){return teamEvents(db,code,true);}

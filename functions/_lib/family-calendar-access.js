import {sha256} from './coach-auth.js';
export async function calendarSchema(db){await db.prepare('CREATE TABLE IF NOT EXISTS family_calendar_tokens(hash TEXT PRIMARY KEY,email TEXT NOT NULL,codes TEXT NOT NULL,expires INTEGER NOT NULL)').run()}
export async function calendarPrincipal(db,token){if(!db||!/^[a-f0-9]{64}$/.test(token||''))return null;await calendarSchema(db);return db.prepare('SELECT email,codes FROM family_calendar_tokens WHERE hash=? AND expires>?').bind(await sha256(token),Date.now()).first()}

import {hasMembership} from './parent-access.js';
import {teamPolicy} from './school-access.js';
import {CONNECTIONS} from '../../assets/family-connections.js';
export async function sharingSchema(db){for(const sql of [
 `CREATE TABLE IF NOT EXISTS family_share_codes(owner_email TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,updated INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS family_share_invites(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,recipient_email TEXT NOT NULL,token_hash TEXT NOT NULL,team_codes TEXT NOT NULL,can_edit INTEGER NOT NULL,is_driver INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,delivery TEXT)`,
 `CREATE TABLE IF NOT EXISTS family_delegates(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,recipient_email TEXT NOT NULL,team_codes TEXT NOT NULL,can_edit INTEGER NOT NULL DEFAULT 0,is_driver INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(owner_email,recipient_email))`,
 `CREATE TABLE IF NOT EXISTS family_share_audit(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,actor_email TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,created INTEGER NOT NULL)`
 ])await db.prepare(sql).run();}
export async function shareable(db,owner,code){
 if(!await db.prepare('SELECT entry_id FROM parent_family WHERE email=? AND team_code=? LIMIT 1').bind(owner,code).first())return false;
 if(CONNECTIONS[code])return true; // Already-public schedule only, never private school data.
 const p=await teamPolicy(db,code);
 return !!p&&['rec','travel'].includes(p.kind)&&!p.school_id&&await hasMembership(db,owner,code);
}
export async function delegated(db,recipient,owner,code,edit=false){
 await sharingSchema(db);
 const grant=await db.prepare("SELECT * FROM family_delegates WHERE owner_email=? AND recipient_email=? AND status='active'").bind(owner,recipient).first();
 if(!grant||!JSON.parse(grant.team_codes).includes(code)||(edit&&!grant.can_edit)||!await shareable(db,owner,code))return null;
 return grant;
}
export function audit(db,owner,actor,action,target){return db.prepare('INSERT INTO family_share_audit VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,actor,action,target,Date.now());}

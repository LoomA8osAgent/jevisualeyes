/** SQLite persistence via node:sqlite (built into Node ≥22.13) — no native module,
 *  so it runs identically under any Node version the launcher uses. */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {AppConfig} from './config.js';

const MIGRATIONS:string[] = [`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  accepted_revision_id TEXT,
  aux_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES revisions(id),
  score_json TEXT NOT NULL,
  score_hash TEXT NOT NULL,
  command_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, command_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_revision_id TEXT REFERENCES revisions(id),
  command_id TEXT NOT NULL,
  status TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0,
  decision_index INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT NOT NULL,
  runtime_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, command_id)
);
CREATE TABLE IF NOT EXISTS pending_decisions (
  decision_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  decision_index INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  extra_json TEXT,
  accepted_receipt_json TEXT,
  UNIQUE(job_id, decision_index)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES pending_decisions(decision_id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  receipt_json TEXT,
  error_json TEXT,
  usage_complete INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(decision_id, attempt_index)
);
CREATE TABLE IF NOT EXISTS job_events (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(job_id, event_id)
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS revisions_project_idx ON revisions(project_id);
`];

export type DB = DatabaseSync & {transaction:<T>(fn:()=>T)=>()=>T};

export function openDb(cfg:AppConfig):DB {
  mkdirSync(cfg.dataDir,{recursive:true});
  const db = new DatabaseSync(join(cfg.dataDir,'jevmusic.db')) as DB;
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
  // better-sqlite3-style transaction helper; nested calls join the outer transaction
  let txDepth=0;
  db.transaction=<T>(fn:()=>T)=>()=>{
    if(txDepth>0)return fn();
    db.exec('BEGIN IMMEDIATE');txDepth++;
    try{const v=fn();db.exec('COMMIT');return v;}
    catch(e){db.exec('ROLLBACK');throw e;}
    finally{txDepth--;}
  };
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as {value:string}|undefined;
  let v = row? parseInt(row.value,10) : 0;
  for(; v<MIGRATIONS.length; v++){
    db.transaction(()=>{
      db.exec(MIGRATIONS[v]);
      db.prepare(`INSERT INTO meta(key,value) VALUES('schema_version',?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(v+1));
    })();
  }
  return db;
}

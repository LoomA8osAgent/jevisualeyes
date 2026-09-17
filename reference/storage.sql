-- Persistence layout sketch, not a complete application migration system.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  accepted_revision_id TEXT,
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
  base_revision_id TEXT NOT NULL REFERENCES revisions(id),
  command_id TEXT NOT NULL,
  status TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0,
  decision_index INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT NOT NULL,
  runtime_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, command_id)
);
CREATE TABLE IF NOT EXISTS pending_decisions (
  decision_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  decision_index INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  accepted_receipt_json TEXT,
  UNIQUE(job_id, decision_index)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES pending_decisions(decision_id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  receipt_json TEXT,
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
-- Application transactions must enforce epoch/index checks, owner checks, revision
-- compatibility, and receipt + score + PRNG + event-log atomic commit.
-- Credentials and session secrets must never be stored in project/trace JSON.

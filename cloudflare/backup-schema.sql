CREATE TABLE IF NOT EXISTS backup_runs (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),
 sha256 TEXT, byte_length INTEGER, chunk_count INTEGER, counts TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS backup_chunks (
 backup_id TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(backup_id,part)
);
CREATE INDEX IF NOT EXISTS backup_runs_completed ON backup_runs(completed_at);

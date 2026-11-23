CREATE TABLE disk_reads (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'done')),
  result TEXT
);
--> statement-breakpoint
CREATE TABLE revoked_devices (
  hash TEXT PRIMARY KEY
);

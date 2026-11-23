CREATE TABLE paired_macs (
  device TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  revoked_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_mac_per_owner ON paired_macs (owner) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE machine_reads (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL UNIQUE REFERENCES paired_macs (device),
  operation TEXT NOT NULL CHECK (operation IN ('read_startup_disk', 'read_node_version')),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'done')),
  result TEXT
);

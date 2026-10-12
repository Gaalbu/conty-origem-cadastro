import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS installs (
  device_id TEXT PRIMARY KEY,
  first_open_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS touches (
  tid TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('campaign', 'referral', 'community')),
  campaign_id TEXT,
  referrer_id TEXT,
  opened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS touches_device ON touches (device_id);

CREATE TABLE IF NOT EXISTS signups (
  creator_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  signed_up_at TEXT NOT NULL,
  decision_json TEXT NOT NULL
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

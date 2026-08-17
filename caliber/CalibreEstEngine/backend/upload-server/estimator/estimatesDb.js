/**
 * Estimate persistence — better-sqlite3, upload-server's own local DB.
 * Deliberately its own file (data/estimates.db) rather than a new table in
 * auth.db: single responsibility, and it keeps this migration path
 * independent of the users schema. Mirrors auth/db.js's connection pattern
 * exactly (see that file's docstring for why upload-server owns its own
 * SQLite files rather than sharing eva_service's).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'estimates.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS estimates (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    business_unit TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS estimate_versions (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL REFERENCES estimates(id),
    version INTEGER NOT NULL,
    inputs_json TEXT NOT NULL,
    bottom_up_json TEXT,
    ml_json TEXT,
    health_json TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(estimate_id, version)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS estimate_audit_events (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  )
`);

export default db;

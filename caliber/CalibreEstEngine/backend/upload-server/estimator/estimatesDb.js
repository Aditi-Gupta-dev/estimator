/**
 * Estimate persistence — better-sqlite3, upload-server's own local DB.
 * Deliberately its own file (data/estimates.db) rather than a new table in
 * auth.db: single responsibility, and it keeps this migration path
 * independent of the users schema. Mirrors auth/db.js's connection pattern
 * exactly (see that file's docstring for why upload-server owns its own
 * SQLite files rather than sharing eva_service's).
 *
 * PHASE 3 additions: reviewer_assignments, estimate_reviews, notifications
 * tables (new — the review/approval lifecycle), plus a handful of columns
 * added to the three tables that already existed. better-sqlite3 has no
 * migrations framework here, same as before — CREATE TABLE IF NOT EXISTS
 * handles brand-new tables, and the generic ALTER-TABLE column migrator
 * below (ported from eva_service's src/storage/db.py::_migrate(), the
 * exact same "iterate a (table, column, type) list, ALTER TABLE ADD COLUMN
 * if missing" pattern already proven there) handles adding columns to
 * tables that already exist on disk from Phase 1/2.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CALIBRE_DATA_DIR lets tests point at an isolated copy of the data
// directory instead of the real one — used to verify the column migration
// below is safe (byte-identical, idempotent) against a real database copy
// before it is ever allowed to run against the live file.
const DATA_DIR = process.env.CALIBRE_DATA_DIR
  ? path.resolve(process.env.CALIBRE_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
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

// ── Phase 3: reviewer assignment ────────────────────────────────────────────
// One row per assignment. Re-assigning (e.g. admin picks a different
// reviewer) inserts a NEW row rather than mutating the old one — the prior
// assignment's history (who was assigned, when, whether they'd started)
// stays intact, consistent with the "never overwrite history" principle
// applied everywhere else in this schema (estimate_versions, reviews).
db.exec(`
  CREATE TABLE IF NOT EXISTS reviewer_assignments (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    reviewer_user_id TEXT NOT NULL,
    assigned_by TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned',
    completed_at TEXT
  )
`);

// ── Phase 3: review record ──────────────────────────────────────────────────
// Permanently tied to the exact version_id reviewed — never updated after
// creation, so V1's CHANGES_REQUESTED review and V2's APPROVED review both
// remain queryable independently, forever.
db.exec(`
  CREATE TABLE IF NOT EXISTS estimate_reviews (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    reviewer_user_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    comments TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// ── Phase 3: in-app notifications ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    estimate_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  )
`);

// (table, column, sql type) — additive-only column migrations for tables
// that may already exist on disk from Phase 1/2 without these columns.
// Safe to re-run: each column is only added if missing.
const COLUMN_MIGRATIONS = [
  // The specific version a reviewer approved — set once, on APPROVED,
  // never changed afterward (a later re-review would be a new estimate
  // action, not a mutation of this pointer).
  ['estimates', 'approved_version_id', 'TEXT'],
  // Resubmission provenance (Part 11): which version this one supersedes,
  // and why. NULL for the original version 1 of every estimate.
  ['estimate_versions', 'previous_version_id', 'TEXT'],
  ['estimate_versions', 'change_reason', 'TEXT'],
  // Structured extra context on audit events that don't fit the existing
  // from_status/to_status/reason columns (Part 7/14) — e.g. which version
  // was under review, which reviewer was assigned. Kept generic (one JSON
  // column) rather than adding a new single-purpose column per event kind.
  ['estimate_audit_events', 'version_id', 'TEXT'],
  ['estimate_audit_events', 'metadata_json', 'TEXT'],
];

function migrateColumns() {
  for (const [table, column, sqlType] of COLUMN_MIGRATIONS) {
    const existingColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!existingColumns.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
    }
  }
}
migrateColumns();

export default db;

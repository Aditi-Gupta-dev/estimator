/**
 * Auth persistence — better-sqlite3, upload-server's own local users DB.
 * Kept separate from eva_service's eva.db: these are two independently
 * deployable services (Node vs Python) with no shared filesystem access
 * assumed, and users/auth belong at the single frontend-facing gateway.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CALIBRE_DATA_DIR lets tests point at an isolated copy of the data
// directory instead of the real one — used for safely verifying schema
// migrations (see estimatesDb.js) without ever touching live data. Unset
// in normal operation, so behavior is unchanged by default.
const DATA_DIR = process.env.CALIBRE_DATA_DIR
  ? path.resolve(process.env.CALIBRE_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'auth.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,              -- admin | super | sme | estimator
    unit TEXT,                       -- free text, descriptive only (matches ManageUsersPanel's "unit" field)
    department TEXT NOT NULL,        -- sales | delivery
    status TEXT NOT NULL DEFAULT 'active',  -- active | inactive | pending
    created_at TEXT NOT NULL,
    last_active_at TEXT
  )
`);

export default db;

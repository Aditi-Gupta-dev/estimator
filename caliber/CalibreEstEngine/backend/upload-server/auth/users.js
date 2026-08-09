/**
 * User CRUD — plain better-sqlite3 (synchronous, no ORM needed at this
 * scale — mirrors eva_service's "no migrations framework at this scale"
 * philosophy for a single-table store).
 */
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import db from './db.js';

const BCRYPT_ROUNDS = 12;

export function createUser({ name, email, password, role, unit, department, status = 'active' }) {
  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, unit, department, status, created_at)
    VALUES (@id, @name, @email, @passwordHash, @role, @unit, @department, @status, @createdAt)
  `).run({
    id, name, email: email.toLowerCase(), passwordHash, role,
    unit: unit ?? null, department, status, createdAt,
  });
  return getUserById(id);
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

export function updateUser(id, fields) {
  const existing = getUserById(id);
  if (!existing) return null;

  const next = {
    name: fields.name ?? existing.name,
    email: (fields.email ?? existing.email).toLowerCase(),
    role: fields.role ?? existing.role,
    unit: fields.unit ?? existing.unit,
    department: fields.department ?? existing.department,
    status: fields.status ?? existing.status,
    password_hash: fields.password ? bcrypt.hashSync(fields.password, BCRYPT_ROUNDS) : existing.password_hash,
  };

  db.prepare(`
    UPDATE users SET name=@name, email=@email, password_hash=@password_hash, role=@role,
      unit=@unit, department=@department, status=@status WHERE id=@id
  `).run({ ...next, id });

  return getUserById(id);
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function touchLastActive(id) {
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

/** Strips password_hash before anything ever reaches the client. */
export function toPublicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

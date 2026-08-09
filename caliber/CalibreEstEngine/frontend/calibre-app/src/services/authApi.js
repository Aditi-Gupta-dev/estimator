/**
 * Auth API — thin fetch wrappers for upload-server's /api/auth/* routes.
 * credentials:'include' is required on every call so the httpOnly session
 * cookie is actually sent/received across the 5173 <-> 3001 origin split.
 */
const AUTH_BASE = 'http://localhost:3001/api/auth';

async function parseJsonSafe(response) {
  return response.json().catch(() => ({}));
}

export async function login(email, password) {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || `Login failed (HTTP ${res.status})`);
  return data.user;
}

export async function logout() {
  await fetch(`${AUTH_BASE}/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
}

/** Returns the current user, or null if not authenticated. Never throws —
 * a 401 here just means "not logged in", not an error worth surfacing. */
export async function getMe() {
  const res = await fetch(`${AUTH_BASE}/me`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await parseJsonSafe(res);
  return data.user || null;
}

// ── Admin-only user management (ManageUsersPanel.jsx) ──────────────────────

export async function listUsers() {
  const res = await fetch(`${AUTH_BASE}/users`, { credentials: 'include' });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || `Failed to load users (HTTP ${res.status})`);
  return data.users;
}

export async function createUser(payload) {
  const res = await fetch(`${AUTH_BASE}/users`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || `Failed to create user (HTTP ${res.status})`);
  return data.user;
}

export async function updateUser(id, payload) {
  const res = await fetch(`${AUTH_BASE}/users/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || `Failed to update user (HTTP ${res.status})`);
  return data.user;
}

export async function deleteUser(id) {
  const res = await fetch(`${AUTH_BASE}/users/${id}`, { method: 'DELETE', credentials: 'include' });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || `Failed to delete user (HTTP ${res.status})`);
}

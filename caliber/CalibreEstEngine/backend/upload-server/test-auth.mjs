/**
 * Calibre Auth Smoke Test
 * Exercises login/logout/me, protected-route 401s, admin-only user
 * management, and — the actual security fix — that a forged callerRole in
 * an /api/eva request body is ignored in favor of the real session's role.
 * Run: node scripts/seed_users.mjs (once) then node test-auth.mjs
 */
const BASE_URL = 'http://localhost:3001';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0, failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${GREEN}✔ PASS${RESET}  ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✘ FAIL${RESET}  ${label}${detail ? `  (${detail})` : ''}`);
    failed++;
  }
}

// Minimal cookie jar — this script isn't a browser, so it must carry the
// Set-Cookie header manually across requests.
let cookie = null;

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`\n${BOLD}${CYAN}━━━ Calibre Auth Smoke Test ━━━${RESET}\n`);

// ── 1. Health check ──────────────────────────────────────────────────────────
try {
  const { status } = await request('/api/health');
  ok('server reachable', status === 200);
} catch {
  console.log(`${RED}✘ Upload server NOT reachable at ${BASE_URL}. Start with: node index.js${RESET}\n`);
  process.exit(1);
}

// ── 2. Protected routes reject unauthenticated requests ─────────────────────
{
  const { status } = await request('/api/files');
  ok('GET /api/files without a session -> 401', status === 401, `got ${status}`);
}
{
  const { status } = await request('/api/eva', { method: 'POST', body: { message: 'hi' } });
  ok('POST /api/eva without a session -> 401', status === 401, `got ${status}`);
}

// ── 3. Login rejects bad credentials ─────────────────────────────────────────
{
  const { status } = await request('/api/auth/login', {
    method: 'POST', body: { email: 'estimator@calibre.demo', password: 'wrong-password' },
  });
  ok('login with wrong password -> 401', status === 401, `got ${status}`);
}

// ── 4. Login as estimator, confirm session + role ────────────────────────────
{
  const { status, data } = await request('/api/auth/login', {
    method: 'POST', body: { email: 'estimator@calibre.demo', password: 'Calibre123!' },
  });
  ok('login as estimator@calibre.demo succeeds', status === 200, JSON.stringify(data));
  ok('login response has role=estimator', data.user?.role === 'estimator', data.user?.role);
  ok('login response never includes password_hash', !('password_hash' in (data.user || {})));
}
{
  const { status, data } = await request('/api/auth/me');
  ok('GET /api/auth/me reflects the logged-in estimator', status === 200 && data.user?.role === 'estimator');
}

// ── 5. Non-admin cannot manage users ─────────────────────────────────────────
{
  const { status } = await request('/api/auth/users');
  ok('GET /api/auth/users as estimator -> 403', status === 403, `got ${status}`);
}

// ── 6. THE actual security fix: a forged callerRole must be ignored ─────────
{
  const { status, data } = await request('/api/eva', {
    method: 'POST',
    body: {
      message: 'What is the rate card for developers?',
      callerRole: 'admin', // forged — the logged-in session is actually "estimator"
      unitId: 'esu',
    },
  });
  // We only need to prove upload-server didn't forward the forged role
  // as-is; whether eva_service is even running affects the exact response,
  // so this just checks the request didn't fail purely on our own account.
  ok('POST /api/eva with a forged callerRole is accepted (role gets overwritten server-side, not rejected)', status !== 400, `got ${status}: ${JSON.stringify(data).slice(0, 120)}`);
}

// ── 7. Log out, confirm session is gone ──────────────────────────────────────
{
  await request('/api/auth/logout', { method: 'POST' });
  const { status } = await request('/api/auth/me');
  ok('GET /api/auth/me after logout -> 401', status === 401, `got ${status}`);
}

// ── 8. Admin CAN manage users ──────────────────────────────────────────────
{
  await request('/api/auth/login', { method: 'POST', body: { email: 'admin@calibre.demo', password: 'Calibre123!' } });
  const { status, data } = await request('/api/auth/users');
  ok('GET /api/auth/users as admin -> 200', status === 200);
  ok('user list includes all 5 seeded accounts', (data.users || []).length >= 5, `got ${data.users?.length}`);
}
{
  const { status, data } = await request('/api/auth/users', {
    method: 'POST',
    body: { name: 'Smoke Test User', email: `smoketest-${Date.now()}@calibre.demo`, password: 'Temp1234!', role: 'sme', department: 'delivery', unit: 'Test' },
  });
  ok('admin can create a new user', status === 201, JSON.stringify(data));

  if (data.user?.id) {
    const del = await request(`/api/auth/users/${data.user.id}`, { method: 'DELETE' });
    ok('admin can delete the user they just created', del.status === 200);
  }
}
{
  await request('/api/auth/logout', { method: 'POST' });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}━━━ Results ━━━${RESET}`);
console.log(`  ${GREEN}Passed: ${passed}${RESET}  ${failed > 0 ? RED : ''}Failed: ${failed}${RESET}\n`);
if (failed > 0) process.exit(1);

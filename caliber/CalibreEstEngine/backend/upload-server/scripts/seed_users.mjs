/**
 * Seeds one demo account per role. Run once manually:
 *   node scripts/seed_users.mjs
 * Safe to re-run — skips any email that already exists rather than
 * resetting accounts an admin has since edited via Manage Users.
 */
import { createUser, getUserByEmail } from '../auth/users.js';

const DEMO_PASSWORD = 'Calibre123!';

const DEMO_USERS = [
  { name: 'Priya Sharma (Admin Demo)', email: 'admin@calibre.demo', role: 'admin', unit: 'COE', department: 'delivery' },
  { name: 'Arjun Mehta (Super User Demo)', email: 'super@calibre.demo', role: 'super', unit: 'Oracle ERP', department: 'sales' },
  { name: 'Lakshmi Nair (SME Demo)', email: 'sme@calibre.demo', role: 'sme', unit: 'Oracle ERP', department: 'delivery' },
  { name: 'Sneha Pillai (Estimator Demo)', email: 'estimator@calibre.demo', role: 'estimator', unit: 'Oracle ERP', department: 'sales' },
];

let created = 0;
for (const demo of DEMO_USERS) {
  if (getUserByEmail(demo.email)) {
    console.log(`  SKIP    ${demo.email} (already exists)`);
    continue;
  }
  createUser({ ...demo, password: DEMO_PASSWORD, status: 'active' });
  console.log(`  OK      ${demo.email}`);
  created++;
}

console.log(`\nDone. ${created} account(s) created.`);
if (created > 0) {
  console.log(`\nDemo password for all seeded accounts: ${DEMO_PASSWORD}`);
  console.log('Change this in a real deployment — these are demo credentials only.\n');
}

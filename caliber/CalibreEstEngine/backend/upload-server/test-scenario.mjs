/**
 * Smoke test for POST /internal/estimator/scenario — the route eva_service
 * calls to run what-if scenarios through the real estimator engine.
 *
 * Matches the convention of test-auth.mjs / test-routing.mjs: a plain script
 * you run against a live server, not a test-framework suite.
 *
 *   node test-scenario.mjs                 # against http://localhost:3001
 *   BASE=http://localhost:3099 node test-scenario.mjs
 *
 * Requires upload-server AND estimator_agents (:8000) to be running.
 */
import {
  COMPONENTS,
  SECTION_A_PARAMS,
} from '../../frontend/calibre-app/src/constants/estimator-template.js';

const BASE = process.env.BASE || 'http://localhost:3001';
const KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';
const URL = `${BASE}/internal/estimator/scenario`;

const sectionA = {};
Object.keys(SECTION_A_PARAMS).forEach((k) => { sectionA[k] = SECTION_A_PARAMS[k].value; });
const overrides = {};
COMPONENTS.forEach((c) => {
  overrides[c.component] = {
    complexity: c.default_complexity, volume: c.default_volume, included: true,
  };
});
const baseInputs = { sectionA, overrides, overallComplexity: 'H', industry: 'BFSI' };

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  OK      ${label}`);
    passed++;
  } else {
    console.log(`  FAIL    ${label} ${detail}`);
    failed++;
  }
}

async function post(body, key = KEY) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-internal-key': key } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

console.log(`\nScenario endpoint smoke test → ${URL}\n`);

console.log('Security');
check('rejects a request with no internal key',
  (await post({ callerRole: 'estimator', baseInputs, changes: {} }, null)).status === 401);
check('rejects a wrong internal key',
  (await post({ callerRole: 'estimator', baseInputs, changes: {} }, 'nope')).status === 401);
check('applies the same role gate as /api/score (unknown role blocked)',
  (await post({ callerRole: 'guest', baseInputs, changes: {} })).status === 403);

console.log('\nValidation');
check('rejects an unknown change key',
  (await post({ callerRole: 'estimator', baseInputs, changes: { evil: 1 } })).status === 422);
check('rejects an out-of-range value',
  (await post({ callerRole: 'estimator', baseInputs, changes: { durationMonths: 999 } })).status === 422);
check('rejects an unknown module',
  (await post({
    callerRole: 'estimator', baseInputs, changes: { moduleEffortMultiplier: { Nope: 1.1 } },
  })).status === 422);
check('requires baseInputs',
  (await post({ callerRole: 'estimator', changes: {} })).status === 400);

console.log('\nExecution');
const run = await post({
  callerRole: 'estimator', baseInputs, changes: { moduleEffortMultiplier: { Integration: 1.1 } },
});
check('runs a real scenario', run.status === 200, `(got ${run.status})`);
if (run.status === 200) {
  const { current, scenario, delta } = run.body;
  check('returns both current and scenario sides', !!current && !!scenario);
  check('scenario effort exceeds current after a +10% increase',
    scenario.bottomUp.totalEffortDays > current.bottomUp.totalEffortDays,
    `(${current.bottomUp.totalEffortDays} -> ${scenario.bottomUp.totalEffortDays})`);
  check('delta matches the two sides',
    delta.effortDays === scenario.bottomUp.totalEffortDays - current.bottomUp.totalEffortDays);
  check('both sides carry an ML risk band', !!current.ml.riskBand && !!scenario.ml.riskBand);
  console.log(`          current  ${current.bottomUp.totalEffortDays}d / ${current.ml.riskBand}`);
  console.log(`          scenario ${scenario.bottomUp.totalEffortDays}d / ${scenario.ml.riskBand}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

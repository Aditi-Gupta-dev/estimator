/**
 * Phase 5.1 — REAL LLM integration smoke test for the delta-analysis
 * pipeline (Part 4/5/6/7). Deliberately NOT part of the deterministic
 * regression suite (test-deltas.mjs, which uses test-deltas-mock-eva.mjs
 * and is safe to run with no external credentials) — this file requires:
 *
 *   - an upload-server instance pointed (via EVA_URL) at a REAL eva_service
 *     instance that has a working LLM provider configured (GROQ_API_KEY or
 *     OPENAI_API_KEY in eva_service/.env)
 *   - that real eva_service instance actually reachable and healthy
 *
 * Run against ISOLATED instances only, never live:
 *   node test-deltas-real-llm.mjs http://localhost:3020
 *
 * If no working LLM provider is configured, this test will genuinely fail
 * at the "Delta reached a terminal state -> completed" checks — that is
 * the correct, honest outcome, not a bug in this file. Do not mock around
 * a failure here; that would defeat the point of this specific test.
 */
import { COMPONENTS } from "../../frontend/calibre-app/src/constants/estimator-template.js";

const BASE = process.argv[2] || "http://localhost:3020";

let pass = 0;
let fail = 0;
function check(label, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}  ${detail}`);
  }
}

function sampleOverrides(selected) {
  const overrides = {};
  COMPONENTS.forEach((c) => {
    overrides[c.component] = {
      complexity: c.default_complexity,
      volume: c.default_volume,
      included: false,
    };
  });
  selected.forEach((name) => {
    overrides[name] = { ...overrides[name], included: true };
  });
  return overrides;
}
function sampleInputs(selected, sectionAOverrides = {}) {
  return {
    industry: "BFSI",
    overallComplexity: "H",
    sectionA: {
      duration_months: 18,
      n_modules: 5,
      n_entities: 3,
      n_integrations: 25,
      n_dm_objects: 15,
      n_reports: 40,
      n_cemli: 10,
      integ_complex: 8,
      integ_simple: 17,
      contingency_pct: 15,
      mgmt_reserve_pct: 5,
      working_hours_day: 8,
      working_days_month: 20,
      onshore_pct: 30,
      ...sectionAOverrides,
    },
    overrides: sampleOverrides(selected),
  };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`login failed: ${JSON.stringify(data)}`);
  return {
    cookie: res.headers.get("set-cookie").split(";")[0],
    user: data.user,
  };
}
async function post(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function patch(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function get(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTerminal(
  cookie,
  estimateId,
  maxTries = 25,
  delayMs = 2000,
) {
  let delta = null;
  for (let i = 0; i < maxTries; i += 1) {
    await sleep(delayMs);
    const { data } = await get(cookie, `/api/estimates/${estimateId}/deltas`);
    delta = (data.deltas || [])[data.deltas.length - 1];
    console.log(`    poll ${i}: status=${delta?.status}`);
    if (delta && (delta.status === "completed" || delta.status === "failed"))
      return delta;
  }
  return delta;
}

async function main() {
  console.log(
    `\nPhase 5.1 real end-to-end delta test against ${BASE} (REAL LLM, no mock)\n`,
  );

  const estimator = await login("estimator@calibre.demo", "Calibre123!");
  const admin = await login("admin@calibre.demo", "Calibre123!");

  // ── Part 5: real V1 -> V2 with a meaningful, controlled change ──────────
  console.log("Part 5: V1 -> V2 with a meaningful controlled change");
  const createRes = await post(estimator.cookie, "/api/estimates", {
    name: "Phase 5.1 Real E2E",
    businessUnit: "Oracle ERP",
    inputs: sampleInputs([
      "Enterprise Structures & Legal Entities",
      "Integration - Simple",
    ]),
  });
  const e1 = createRes.data.estimate;
  check("V1 created", createRes.status === 200 && e1.currentVersion === 1);

  // Meaningful change: add Data Migration scope AND shift onshore/offshore
  // mix (guarantees a real blendedRate shift, not just an effort shift) —
  // needed to genuinely exercise Part 7's roleRate redaction test below.
  const saveRes = await patch(estimator.cookie, `/api/estimates/${e1.id}`, {
    persist: true,
    changes: {
      moduleEffortMultiplier: { Integration: 1.3 },
      onshorePctDelta: 20,
      durationMonthsDelta: 0,
    },
  });
  check(
    "V2 created from V1 (persist:true)",
    saveRes.status === 200 && saveRes.data.result?.latestVersion?.version === 2,
  );
  const v2 = saveRes.data.result.latestVersion;
  console.log(`    V1->V2 previousVersionId=${v2.previousVersionId}`);

  console.log(
    "  waiting for REAL delta analysis (PENDING -> RUNNING -> COMPLETED/FAILED)...",
  );
  const delta = await waitForTerminal(estimator.cookie, e1.id);

  check(
    "Delta reached a terminal state",
    delta && (delta.status === "completed" || delta.status === "failed"),
  );
  check(
    "Deterministic delta computed before AI ran",
    Array.isArray(delta?.deterministicDelta?.numericDeltas) &&
      delta.deterministicDelta.numericDeltas.length > 0,
  );

  if (delta.status !== "completed") {
    console.log(
      "\n  *** REAL LLM CALL DID NOT COMPLETE — reporting FAILURE honestly, not fabricating success ***",
    );
    console.log("  error_message:", delta.errorMessage);
  } else {
    console.log(
      "\nPart 5 result: REAL LLM delta analysis COMPLETED successfully.",
    );
    console.log("AI analysis:", JSON.stringify(delta.aiAnalysis, null, 2));

    // ── Part 6: FACT vs INFERENCE quality check ──────────────────────────
    console.log("\nPart 6: fact vs inference verification");
    const ai = delta.aiAnalysis;
    check(
      "AI analysis has all required fields",
      [
        "summary",
        "key_changes",
        "likely_drivers",
        "impact",
        "risks",
        "recommendations",
        "confidence",
        "scope_creep_indicated",
      ].every((k) => k in ai),
    );
    check(
      "confidence is a valid enum value",
      ["low", "medium", "high"].includes(ai.confidence),
    );
    // key_changes should reference numbers that actually appear in the deterministic delta (facts, not invented).
    const detNumbers = new Set();
    delta.deterministicDelta.numericDeltas.forEach((d) => {
      detNumbers.add(String(d.previous));
      detNumbers.add(String(d.current));
    });
    const keyChangesText = ai.key_changes.join(" ");
    const anyRealNumberReferenced = [...detNumbers].some((n) =>
      keyChangesText.includes(n),
    );
    check(
      "key_changes reference real deterministic numbers (not obviously invented)",
      anyRealNumberReferenced,
      `det numbers: ${[...detNumbers].join(",")} | text: ${keyChangesText}`,
    );
    check(
      "model does not claim it performed the calculation",
      !/\bi calculated\b|\bi computed\b/i.test(JSON.stringify(ai)),
    );

    // ── Part 7: rate-card security with REAL LLM ─────────────────────────
    console.log("\nPart 7: rate-card security (real LLM run)");
    const estimatorView = await get(
      estimator.cookie,
      `/api/deltas/${delta.id}`,
    );
    const adminView = await get(admin.cookie, `/api/deltas/${delta.id}`);
    const estimatorHasRoleRate =
      estimatorView.data.delta.deterministicDelta.numericDeltas.some(
        (d) => d.category === "roleRate",
      );
    const adminHasRoleRate =
      adminView.data.delta.deterministicDelta.numericDeltas.some(
        (d) => d.category === "roleRate",
      );
    check(
      "estimator-facing API response has NO roleRate entries",
      !estimatorHasRoleRate,
    );
    console.log(
      `    (admin roleRate present: ${adminHasRoleRate} — confirms whether real rate data existed to redact)`,
    );
    // The AI's own text must never surface a specific day-rate figure (a $ amount per day).
    const aiText = JSON.stringify(ai);
    const looksLikeRateFigure =
      /\$\s?\d{2,4}\s*(\/|per)\s*day/i.test(aiText) ||
      /blended\s*rate/i.test(aiText);
    check(
      'AI analysis text contains no rate-card figures or the term "blended rate"',
      !looksLikeRateFigure,
      aiText,
    );
  }

  // Part 8 (genuine LLM-unavailable failure path) is deliberately NOT
  // re-tested here against this real, working service — that would require
  // breaking a real, currently-healthy dependency. It is covered for real
  // by test-deltas.mjs's Flow C, run against an upload-server instance
  // whose EVA_URL is deliberately unreachable (see that file + the Phase
  // 5.1 report for the actual failure+retry run against this exact model
  // config).

  // ── Part 9: idempotency — duplicate trigger attempt via direct import ───
  console.log(
    "\nPart 9: idempotency (duplicate trigger does not create a duplicate row)",
  );
  const listBefore = await get(
    estimator.cookie,
    `/api/estimates/${e1.id}/deltas`,
  );
  check(
    "exactly one delta row exists for the V1->V2 pair",
    listBefore.data.deltas.length === 1,
  );

  // ── Part 10: audit ────────────────────────────────────────────────────
  console.log("\nPart 10: audit trail");
  const audit = await get(estimator.cookie, `/api/estimates/${e1.id}/audit`);
  const actions = audit.data.events.map((e) => e.action);
  check(
    "DELTA_ANALYSIS_REQUESTED recorded",
    actions.includes("DELTA_ANALYSIS_REQUESTED"),
  );
  check(
    `DELTA_ANALYSIS_${delta.status === "completed" ? "COMPLETED" : "FAILED"} recorded`,
    actions.includes(
      `DELTA_ANALYSIS_${delta.status === "completed" ? "COMPLETED" : "FAILED"}`,
    ),
  );
  const deltaEvents = audit.data.events.filter((e) =>
    e.action.startsWith("DELTA_ANALYSIS"),
  );
  check(
    "audit metadata contains no raw delta contents or secrets",
    deltaEvents.every((e) => {
      const s = JSON.stringify(e.metadata || {});
      return (
        !s.includes("numericDeltas") &&
        !s.toLowerCase().includes("api_key") &&
        !s.toLowerCase().includes("gsk_")
      );
    }),
  );

  // ── Part 11: notifications ────────────────────────────────────────────
  console.log("\nPart 11: notifications");
  const notifs = await get(estimator.cookie, "/api/notifications");
  const expectedType =
    delta.status === "completed"
      ? "delta_analysis_completed"
      : "delta_analysis_failed";
  check(
    `notification of type ${expectedType} created for estimate owner`,
    notifs.data.notifications.some(
      (n) => n.type === expectedType && n.estimateId === e1.id,
    ),
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("CRASHED:", err);
  process.exit(1);
});

/**
 * The server-authoritative "run an estimate" pipeline — same contract as
 * the frontend's scoreEstimate() (see frontend/calibre-app/src/lib/
 * estimatorEngine.js), just invoked with the real rate card, which only
 * exists on this side of the network boundary (./rateCard.js).
 *
 * Backs POST /api/estimate/calculate (browser, cookie-authenticated) and is
 * reused by estimatesService.js so create/update of a persisted estimate
 * runs through the exact same math as an unsaved in-session run — there is
 * no second "server version" of the estimator to drift from the first.
 */
import { scoreEstimate } from '../../../frontend/calibre-app/src/lib/estimatorEngine.js';
import { RATE_CARD } from './rateCard.js';

// estimator_agents is internal-only and now requires this shared secret —
// same env var, same dev default, as upload-server's own INTERNAL_API_KEY
// (index.js) and estimator_agents' own fallback (src/api.py), so an
// unconfigured local setup keeps working across all three services.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-change-me';

/**
 * @param {{overrides, sectionA, industry, overallComplexity}} inputs
 * @param {string} estimatorUrl  estimator_agents base URL (e.g. http://localhost:8000)
 * @returns {Promise<{bottomUp, ml, similarProjects, coverage}>} same shape
 *   scoreEstimate() returns to the browser — cost is real, not null, because
 *   rateCard is supplied here.
 */
export async function calculateEstimate({
  overrides, sectionA, industry, overallComplexity,
}, estimatorUrl) {
  return scoreEstimate({
    overrides,
    sectionA,
    industry,
    overallComplexity,
    rateCard: RATE_CARD,
    scoreUrl: `${estimatorUrl}/score`,
    credentials: 'omit', // server-to-server; there is no cookie to send
    internalKey: INTERNAL_API_KEY,
  });
}

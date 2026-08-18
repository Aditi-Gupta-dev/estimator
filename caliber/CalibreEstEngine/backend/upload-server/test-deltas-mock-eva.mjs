// Test double for eva_service's POST /internal/delta-analysis, companion
// fixture to test-deltas.mjs —
// used only because this dev environment's configured Groq credentials
// return 404 model_not_found (a pre-existing, unrelated environment issue,
// not a Phase 5 bug — verified by log inspection). Lets the SUCCESS path
// (COMPLETED status, AI analysis persistence/shape, notifications, audit)
// be tested deterministically without depending on external LLM
// availability. The FAILURE path is tested against the real (currently
// broken-credentialed) isolated eva_service, which is an entirely genuine
// failure, not simulated.
import http from 'http';

const PORT = process.argv[2] || 8012;

let lastRequest = null;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_last-request') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lastRequest));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/internal/delta-analysis') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    lastRequest = parsed; // exposed via GET /_last-request so tests can prove what the "LLM" actually received
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      summary: `Mock analysis for ${parsed.estimateName || 'an estimate'}.`,
      key_changes: ['Effort changed per the deterministic delta.'],
      likely_drivers: ['Mock driver — scope adjustment.'],
      impact: 'Mock impact statement.',
      risks: ['Mock risk.'],
      recommendations: ['Mock recommendation.'],
      confidence: 'medium',
      scope_creep_indicated: false,
    }));
  });
});

server.listen(PORT, () => console.log(`mock eva delta-analysis double listening on ${PORT}`));

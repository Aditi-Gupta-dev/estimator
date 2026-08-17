/**
 * Knowledge Hub governance API — thin fetch wrappers for upload-server's
 * /api/documents* and /api/knowledge/audit routes (proxied to eva_service).
 * Same conventions as authApi.js: hardcoded base, credentials:'include'.
 *
 * One difference from authApi.js worth calling out: eva_service's
 * documents_route.py returns business-logic failures (invalid transition,
 * document not found, capability re-check) as HTTP 200 with
 * `{success:false, error}` in the body, not as a non-2xx status — only the
 * gateway's own capability gate (403) and network failures (502) are real
 * HTTP errors. So every call here checks BOTH `!res.ok` and
 * `data.success === false`, not just res.ok, or a rejected publish would
 * silently look like it succeeded.
 */
const API_BASE = 'http://localhost:3001/api';

async function parseJsonSafe(response) {
  return response.json().catch(() => ({}));
}

function assertOk(res, data, fallbackMessage) {
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `${fallbackMessage} (HTTP ${res.status})`);
  }
}

export async function listDocuments() {
  const res = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
  const data = await parseJsonSafe(res);
  assertOk(res, data, 'Failed to load documents');
  return data.documents;
}

export async function getKnowledgeAudit() {
  const res = await fetch(`${API_BASE}/knowledge/audit`, { credentials: 'include' });
  const data = await parseJsonSafe(res);
  assertOk(res, data, 'Failed to load Knowledge Hub audit');
  return data; // { metrics, orphansOnDisk, duplicateGroups }
}

/** payload: { status?, sensitivity?, ownerUserId?, ownerName?, reason? } */
export async function patchDocument(id, payload) {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  assertOk(res, data, 'Failed to update document');
  return data; // { changed, document }
}

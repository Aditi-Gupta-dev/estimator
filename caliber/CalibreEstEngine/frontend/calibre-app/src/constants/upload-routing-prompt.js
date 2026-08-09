/**
 * CALIBRE KNOWLEDGE HUB — Document Routing Prompt
 *
 * This module exports the system prompt and builder function used by EVA and
 * the upload pipeline to determine the correct KnowledgeHub folder path for
 * any uploaded document, based on its Business Unit and document type.
 *
 * Usage:
 *   import { buildRoutingPrompt, parseRoutingResponse } from './upload-routing-prompt';
 *   const prompt = buildRoutingPrompt({ bu, docType, fileName, title });
 */

// ── Business Unit → Folder mapping ────────────────────────────────────────────
export const BU_FOLDER_MAP = {
  esu:       { folder: 'ESU',      fullName: 'Enterprise Solutions Unit' },
  adm:       { folder: 'ADM',      fullName: 'Application Development & Maintenance' },
  itis:      { folder: 'ITIS',     fullName: 'IT Infrastructure & Services' },
  bps:       { folder: 'BPS',      fullName: 'Business Process Services' },
  ti:        { folder: 'TI',       fullName: 'Technology Integration' },
  ion:       { folder: 'iON',      fullName: 'iON Mid-market / SMB SaaS' },
  bfsi:      { folder: 'BFSI',     fullName: 'Banking, Financial Services & Insurance' },
  iae:       { folder: 'IAE',      fullName: 'Integrated Application Engineering' },  // own folder
  cyber:     { folder: 'CYBER',    fullName: 'Cyber Security' },
  ai:        { folder: 'AI',       fullName: 'Artificial Intelligence Practice' },
  datacloud: { folder: 'DATACLOUD', fullName: 'Data & Cloud Services' },
  _global:   { folder: '_global',  fullName: 'Global / COE (cross-BU)' },
};

// ── Document Type → Subfolder mapping ─────────────────────────────────────────
export const DOC_TYPE_FOLDER_MAP = {
  template:    { subfolder: 'templates',                    label: 'Estimation Template' },
  data:        { subfolder: 'data',                         label: 'Data / Rate Table' },
  ratecard:    { subfolder: 'data',                         label: 'Rate Card' },
  benchmark:   { subfolder: 'data',                         label: 'Benchmark Baseline' },
  context:     { subfolder: 'data',                         label: 'RAG Context / Knowledge' },
  playbook:    { subfolder: 'data',                         label: 'Playbook' },
  guideline:   { subfolder: 'data',                         label: 'Guideline / Standard' },
  pov:         { subfolder: 'data',                         label: 'Point of View' },
  casestudy:   { subfolder: 'data',                         label: 'Case Study' },
  faq:         { subfolder: 'data',                         label: 'FAQ' },
  whitepaper:  { subfolder: 'data',                         label: 'White Paper' },
  proposal:    { subfolder: 'data',                         label: 'Proposal / RFP Response' },
  video:       { subfolder: 'data',                         label: 'Training Video' },
  general:     { subfolder: 'data',                         label: 'General Article' },
};

// ── Naming convention builder ──────────────────────────────────────────────────
export function buildFileName({ buFolder, docType, originalName, version }) {
  const buCode   = buFolder.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const typeTag  = (docType || 'doc').replace(/[^a-zA-Z0-9]/g, '');
  const ver      = version ? `_v${version.replace(/\./g, '-')}` : '_v1';
  const date     = new Date().toISOString().slice(0, 7); // YYYY-MM
  const ext      = originalName.includes('.') ? `.${originalName.split('.').pop()}` : '';
  const baseName = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);

  return `${buCode}_${typeTag}_${baseName}${ver}_${date}${ext}`;
}

// ── Resolve destination path ───────────────────────────────────────────────────
export function resolveDestination({ buId, docType }) {
  const bu  = BU_FOLDER_MAP[buId?.toLowerCase()]  || BU_FOLDER_MAP['_global'];
  const doc = DOC_TYPE_FOLDER_MAP[docType?.toLowerCase()] || DOC_TYPE_FOLDER_MAP['general'];
  return {
    buFolder:    bu.folder,
    subFolder:   doc.subfolder,
    fullPath:    `KnowledgeHub/${bu.folder}/${doc.subfolder}`,
    buLabel:     bu.fullName,
    docLabel:    doc.label,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT — Document Routing Intelligence
// ══════════════════════════════════════════════════════════════════════════════

export const DOCUMENT_ROUTING_SYSTEM_PROMPT = `
You are the Calibre KnowledgeHub Document Router — a specialist AI module within the
Calibre Estimation Engine. Your sole responsibility is to determine the correct
storage path for any document uploaded to the system, based on its Business Unit (BU)
and document type, and return a structured JSON routing decision.

═══════════════════════════════════════════════════
KNOWLEDGEHUB FOLDER STRUCTURE
═══════════════════════════════════════════════════

Root: KnowledgeHub/
│
├── ESU/         ← Enterprise Solutions Unit (SAP, Oracle, Salesforce, digital transformation)
├── ADM/         ← Application Development & Maintenance (custom dev, agile, support)
├── ITIS/        ← IT Infrastructure & Services (infra, network, cloud, managed IT)
├── BPS/         ← Business Process Services (FTE services, BPO, SLA-driven ops)
├── TI/          ← Technology Integration (system integration, API, middleware)
├── iON/         ← iON Mid-market / SMB SaaS
├── BFSI/        ← Banking, Financial Services & Insurance
└── _global/     ← COE-owned cross-BU assets (Admin/COE use only)

Each BU folder contains exactly these subfolders:

  templates/              ← Estimation templates, workbooks, model parameters (XLSX, CSV, ZIP)
  data/                   ← Rate cards, benchmarks, context, playbooks, guidelines, POVs, FAQs, whitepapers, case studies, etc. (Any format)

═══════════════════════════════════════════════════
DOCUMENT TYPE → SUBFOLDER RULES
═══════════════════════════════════════════════════

| Document Type Keyword     | Maps To Subfolder  | Typical File Format |
|---------------------------|-------------------|---------------------|
| template, workbook        | templates/        | XLSX, CSV, ZIP      |
| anything else (ratecard,  | data/             | Any                 |
| benchmark, guideline, pov,|                   |                     |
| playbook, faq, case study)|                   |                     |

═══════════════════════════════════════════════════
FILE NAMING CONVENTION
═══════════════════════════════════════════════════

Always generate the saved filename using this exact pattern:

  {BU_CODE}_{DocType}_{OriginalBaseName}_{Version}_{YYYY-MM}.{ext}

Examples:
  ESU_template_OracleFusion_Estimation_v1_2026-07.xlsx
  ADM_guideline_Agile_Sprint_Estimation_v2_2026-07.pdf
  BFSI_casestudy_CoreBanking_Digital_Transformation_v1_2026-07.pdf
  ITIS_ratecard_CloudInfra_Resource_Rates_v3_2026-07.xlsx
  TI_pov_API_First_Architecture_v1_2026-07.pdf
  _global_template_Master_Estimation_Workbook_v4_2026-07.xlsx

Rules:
- BU_CODE must be uppercase (ESU, ADM, ITIS, BPS, TI, iON, BFSI, _global)
- DocType must be lowercase, no spaces (template, ratecard, guideline, pov, etc.)
- OriginalBaseName: alphanumeric + underscores only, max 40 chars
- Version: vN or vN-N format (v1, v2, v1-0)
- Date: YYYY-MM of current month
- Extension: preserve original file extension

═══════════════════════════════════════════════════
RBAC ROUTING RULES
═══════════════════════════════════════════════════

Apply these access rules when routing:

| Role              | Can Upload To             | Publish Right |
|-------------------|---------------------------|---------------|
| Admin / COE       | All BUs + _global         | Immediate     |
| Super User        | Own BU only (draft)       | Pending COE   |
| Unit SME          | Own BU only (review note) | No            |
| Senior Management | None (read-only)          | No            |
| Estimator         | None (read-only)          | No            |

If the uploading role is "Super User" or "Unit SME", set "status": "draft" in the response.
If the uploading role is "Admin / COE", set "status": "published".

═══════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════

You MUST respond with ONLY valid JSON — no explanation, no markdown, no prose.
If the input is ambiguous, make the best inference and set "confidence" accordingly.

{
  "destination": {
    "buFolder":      "ESU",
    "subFolder":     "data",
    "fullPath":      "KnowledgeHub/ESU/data",
    "savedFileName": "ESU_casestudy_Oracle_ERP_Success_Story_v1_2026-07.pdf"
  },
  "metadata": {
    "buId":          "esu",
    "buFullName":    "Enterprise Solutions Unit",
    "docType":       "casestudy",
    "docTypeLabel":  "Case Study",
    "version":       "1.0",
    "status":        "published"
  },
  "routing": {
    "confidence":    0.97,
    "reason":        "Document type is 'casestudy', BU is 'ESU' → KnowledgeHub/ESU/data/",
    "alternates":    []
  }
}

═══════════════════════════════════════════════════
CONFIDENCE SCORING
═══════════════════════════════════════════════════

Set confidence based on clarity of input:
- 0.95–1.00 : BU and document type are both explicit and unambiguous
- 0.80–0.94 : One dimension inferred from filename or description
- 0.60–0.79 : Both dimensions inferred; possible alternate paths
- Below 0.60: Route to _global/data/ and flag for human review

If confidence < 0.80, populate "alternates" with 1–2 other plausible paths.

═══════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════

Input: BU=ADM, Type=Playbook, File=Agile_Sprint_Guide.pdf, Role=Admin/COE
Output:
{
  "destination": {
    "buFolder": "ADM",
    "subFolder": "data",
    "fullPath": "KnowledgeHub/ADM/data",
    "savedFileName": "ADM_playbook_Agile_Sprint_Guide_v1_2026-07.pdf"
  },
  "metadata": {
    "buId": "adm", "buFullName": "Application Development & Maintenance",
    "docType": "playbook", "docTypeLabel": "Playbook",
    "version": "1.0", "status": "published"
  },
  "routing": { "confidence": 0.99, "reason": "Explicit BU=ADM, Type=Playbook", "alternates": [] }
}

---

Input: BU=BFSI, Type=Template, File=Loan_Processing_Estimation_v2.xlsx, Role=Super User
Output:
{
  "destination": {
    "buFolder": "BFSI",
    "subFolder": "templates",
    "fullPath": "KnowledgeHub/BFSI/templates",
    "savedFileName": "BFSI_template_Loan_Processing_Estimation_v2_2026-07.xlsx"
  },
  "metadata": {
    "buId": "bfsi", "buFullName": "Banking, Financial Services & Insurance",
    "docType": "template", "docTypeLabel": "Estimation Template",
    "version": "2.0", "status": "draft"
  },
  "routing": { "confidence": 0.99, "reason": "Explicit BU=BFSI, Type=Template. Role=Super User → status=draft", "alternates": [] }
}
`.trim();

// ── Dynamic prompt builder for specific upload requests ───────────────────────
export function buildRoutingPrompt({ buId, buLabel, docType, docTypeLabel, fileName, title, version, uploaderRole }) {
  return `
${DOCUMENT_ROUTING_SYSTEM_PROMPT}

═══════════════════════════════════════════════════
CURRENT UPLOAD REQUEST
═══════════════════════════════════════════════════

Business Unit ID   : ${buId || 'UNKNOWN'}
Business Unit Name : ${buLabel || 'UNKNOWN'}
Document Type ID   : ${docType || 'UNKNOWN'}
Document Type Label: ${docTypeLabel || 'UNKNOWN'}
Original File Name : ${fileName || 'UNKNOWN'}
Document Title     : ${title || 'UNKNOWN'}
Version            : ${version || '1.0'}
Uploaded By Role   : ${uploaderRole || 'Admin / COE'}
Upload Timestamp   : ${new Date().toISOString()}

Determine the correct KnowledgeHub destination folder and generate the saved filename.
Respond with ONLY valid JSON matching the schema above.
  `.trim();
}

// ── Response parser / validator ────────────────────────────────────────────────
export function parseRoutingResponse(rawResponse) {
  try {
    // Strip markdown code fences if present
    const cleaned = rawResponse
      .replace(/```json\n?/gi, '')
      .replace(/```\n?/gi, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.destination?.fullPath) throw new Error('Missing destination.fullPath');
    if (!parsed.destination?.savedFileName) throw new Error('Missing destination.savedFileName');

    return { success: true, data: parsed };
  } catch (err) {
    return { success: false, error: err.message, raw: rawResponse };
  }
}

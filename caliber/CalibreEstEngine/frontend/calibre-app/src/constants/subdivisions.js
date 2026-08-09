// ─── Knowledge Hub Subdivision Definitions ────────────────────────────────────
// We define exactly two subdivisions:
// 1. Templates (picks up files from the 'templates' subfolder)
// 2. Artefacts (picks up files from the 'data' subfolder)
export const SUBDIVISIONS = [
  {
    id: 'templates',
    label: 'Templates',
    color: '#34D399',
    bg: 'rgba(52,211,153,0.1)',
    border: 'rgba(52,211,153,0.3)',
    types: ['template'],
    description: 'Ready-to-use estimation templates and spreadsheets'
  },
  {
    id: 'artefacts',
    label: 'Artefacts',
    color: '#00D4FF',
    bg: 'rgba(0,212,255,0.1)',
    border: 'rgba(0,212,255,0.3)',
    types: [
      'guideline',
      'pov',
      'playbook',
      'casestudy',
      'faq',
      'whitepaper',
      'proposal',
      'video',
      'general',
      'data',
      'ratecard',
      'benchmark'
    ],
    description: 'Guidelines, Points of View, Playbooks, Case Studies, FAQs and references'
  }
];

export const SUBDIVISION_MAP = Object.fromEntries(SUBDIVISIONS.map((s) => [s.id, s]));

export const TYPE_TO_SUBDIVISION = {};
SUBDIVISIONS.forEach((sub) => {
  sub.types.forEach((t) => {
    TYPE_TO_SUBDIVISION[t] = sub.id;
  });
});

export function getVisibleSubdivisions(roleId) {
  // Both subdivisions are visible to all roles, but specific content types (e.g. 'ratecard', 'data') 
  // are filtered out inside useKnowledgeHub.js based on role permissions.
  return SUBDIVISIONS;
}

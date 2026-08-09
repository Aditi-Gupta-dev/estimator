// ─── Business Unit Definitions ────────────────────────────────────────────────
import {
  IconBuildingSkyscraper,
  IconCode,
  IconServer,
  IconBriefcase,
  IconNetwork,
  IconShieldLock,
  IconRobot,
  IconCloud,
  IconApps,
} from '@tabler/icons-react';

export const BUSINESS_UNITS = [
  {
    id: 'esu',
    code: 'ESU',
    fullName: 'Enterprise Solutions Unit',
    shortDesc: 'Enterprise platform implementations — SAP, Oracle, Salesforce and large-scale digital transformation.',
    color: '#00D4FF',
    glowColor: 'rgba(0,212,255,0.18)',
    borderHover: 'rgba(0,212,255,0.45)',
    Icon: IconBuildingSkyscraper,
    department: 'both',
    order: 1,
    programTypes: ['oracle', 'sap', 'peoplesoft', 'servicenow', 'salesforce', 'general'],
  },
  {
    id: 'adm',
    code: 'ADM',
    fullName: 'Application Development & Maintenance',
    shortDesc: 'Custom software development, agile delivery, application support and maintenance lifecycle.',
    color: '#34D399',
    glowColor: 'rgba(52,211,153,0.18)',
    borderHover: 'rgba(52,211,153,0.45)',
    Icon: IconCode,
    department: 'both',
    order: 2,
    programTypes: ['oracle', 'java', 'dotnet', 'python', 'agile', 'general'],
  },
  {
    id: 'itis',
    code: 'ITIS',
    fullName: 'IT Infrastructure & Services',
    shortDesc: 'Infrastructure design, server, network, storage, end-user computing and managed IT services.',
    color: '#FFB347',
    glowColor: 'rgba(255,179,71,0.18)',
    borderHover: 'rgba(255,179,71,0.45)',
    Icon: IconServer,
    department: 'both',
    order: 3,
    programTypes: ['server', 'network', 'storage', 'cloud', 'enduser', 'general'],
  },
  {
    id: 'bps',
    code: 'BPS',
    fullName: 'Business Process Services',
    shortDesc: 'FTE-based managed services, business process outsourcing and SLA-driven operations.',
    color: '#A78BFA',
    glowColor: 'rgba(167,139,250,0.18)',
    borderHover: 'rgba(167,139,250,0.45)',
    Icon: IconBriefcase,
    department: 'both',
    order: 4,
    programTypes: ['finance-accounting', 'hr', 'customer-ops', 'supply-chain', 'general'],
  },
  {
    id: 'ti',
    code: 'TI',
    fullName: 'Technology Integration',
    shortDesc: 'System integration, API design, middleware, iPaaS and enterprise architecture services.',
    color: '#2DD4BF',
    glowColor: 'rgba(45,212,191,0.18)',
    borderHover: 'rgba(45,212,191,0.45)',
    Icon: IconNetwork,
    department: 'both',
    order: 5,
    programTypes: ['mulesoft', 'boomi', 'azure-apim', 'api-rest', 'general'],
  },
  {
    id: 'cyber',
    code: 'Cyber Security',
    fullName: 'Cyber Security',
    shortDesc: 'Security assessments, SOC operations, zero-trust, penetration testing and compliance.',
    color: '#FF6B6B',
    glowColor: 'rgba(255,107,107,0.18)',
    borderHover: 'rgba(255,107,107,0.45)',
    Icon: IconShieldLock,
    department: 'both',
    order: 6,
    programTypes: ['soc', 'iam', 'penetration-testing', 'compliance', 'zero-trust', 'general'],
  },
  {
    id: 'ai',
    code: 'AI',
    fullName: 'Artificial Intelligence Practice',
    shortDesc: 'AI/ML model development, GenAI implementations, NLP, computer vision and MLOps.',
    color: '#7C6FFF',
    glowColor: 'rgba(124,111,255,0.18)',
    borderHover: 'rgba(124,111,255,0.45)',
    Icon: IconRobot,
    department: 'both',
    order: 7,
    programTypes: ['ml', 'genai', 'nlp', 'computer-vision', 'mlops', 'general'],
  },
  {
    id: 'datacloud',
    code: 'Data & Cloud',
    fullName: 'Data & Cloud Services',
    shortDesc: 'Cloud migration, data engineering, analytics, data warehousing and cloud-native architectures.',
    color: '#38BDF8',
    glowColor: 'rgba(56,189,248,0.18)',
    borderHover: 'rgba(56,189,248,0.45)',
    Icon: IconCloud,
    department: 'both',
    order: 8,
    programTypes: ['aws', 'azure', 'gcp', 'data-engineering', 'analytics', 'general'],
  },
  {
    id: 'iae',
    code: 'IAE',
    fullName: 'Integrated Application Engineering',
    shortDesc: 'Legacy modernisation, application re-engineering, low-code platforms and composable architecture.',
    color: '#84CC16',
    glowColor: 'rgba(132,204,22,0.18)',
    borderHover: 'rgba(132,204,22,0.45)',
    Icon: IconApps,
    department: 'both',
    order: 9,
    programTypes: ['servicenow', 'outsystems', 'pega', 'legacy-modernisation', 'general'],
  },
];

// Map for fast lookup by id
export const BU_MAP = Object.fromEntries(BUSINESS_UNITS.map((bu) => [bu.id, bu]));

// ── Content Type Definitions ───────────────────────────────────────────────────
// 'template' → saved to KnowledgeHub/{BU}/templates/
// everything else → saved to KnowledgeHub/{BU}/data/
export const CONTENT_TYPES = [
  // ── Templates folder ─────────────────────────────────────────────────────
  { id: 'template',   label: 'Template',        folder: 'templates', color: '#34D399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.3)',  icon: 'table' },
  // ── Data folder (all other types) ────────────────────────────────────────
  { id: 'guideline',  label: 'Guideline',        folder: 'data',      color: '#00D4FF', bg: 'rgba(0,212,255,0.1)',   border: 'rgba(0,212,255,0.3)',   icon: 'file-text' },
  { id: 'data',       label: 'Data',             folder: 'data',      color: '#FFB347', bg: 'rgba(255,179,71,0.1)',  border: 'rgba(255,179,71,0.3)',  icon: 'chart-bar' },
  { id: 'pov',        label: 'Point of View',    folder: 'data',      color: '#A78BFA', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)', icon: 'bulb' },
  { id: 'faq',        label: 'FAQ',              folder: 'data',      color: '#2DD4BF', bg: 'rgba(45,212,191,0.1)',  border: 'rgba(45,212,191,0.3)',  icon: 'help-circle' },
  { id: 'casestudy',  label: 'Case Study',       folder: 'data',      color: '#FF6B6B', bg: 'rgba(255,107,107,0.1)', border: 'rgba(255,107,107,0.3)', icon: 'presentation' },
  { id: 'playbook',   label: 'Playbook',         folder: 'data',      color: '#38BDF8', bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.3)',  icon: 'book' },
  { id: 'whitepaper', label: 'White Paper',      folder: 'data',      color: '#7C6FFF', bg: 'rgba(124,111,255,0.1)', border: 'rgba(124,111,255,0.3)', icon: 'file-description' },
  { id: 'ratecard',   label: 'Rate Card',        folder: 'data',      color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)',  icon: 'coin' },
  { id: 'benchmark',  label: 'Benchmark',        folder: 'data',      color: '#10B981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.3)',  icon: 'chart-line' },
  { id: 'proposal',   label: 'Proposal',         folder: 'data',      color: '#EC4899', bg: 'rgba(236,72,153,0.1)',  border: 'rgba(236,72,153,0.3)',  icon: 'file-invoice' },
  { id: 'video',      label: 'Training Video',   folder: 'data',      color: '#84CC16', bg: 'rgba(132,204,22,0.1)',  border: 'rgba(132,204,22,0.3)',  icon: 'video' },
];

export const CONTENT_TYPE_MAP = Object.fromEntries(CONTENT_TYPES.map((t) => [t.id, t]));

// ── File Type Config ───────────────────────────────────────────────────────────
export const FILE_TYPE_CONFIG = {
  pdf:  { color: '#F87171', icon: 'file-type-pdf',  label: 'PDF' },
  xlsx: { color: '#34D399', icon: 'file-spreadsheet', label: 'XLSX' },
  docx: { color: '#60A5FA', icon: 'file-text',       label: 'DOCX' },
  pptx: { color: '#FB923C', icon: 'presentation',    label: 'PPTX' },
  csv:  { color: '#FFB347', icon: 'file-spreadsheet', label: 'CSV' },
  mp4:  { color: '#84CC16', icon: 'video',            label: 'MP4' },
  zip:  { color: '#A78BFA', icon: 'file-zip',         label: 'ZIP' },
};

// ── EVA suggestion chips per BU (for right panel) ─────────────────────────────
export const BU_EVA_SUGGESTIONS = {
  all:       ['Which unit has the most templates?', 'Show me all Case Studies', 'How do I use a Playbook?', 'What Training Videos are available?'],
  esu:       ['Best estimation approach for ESU projects?', 'Show ESU templates', 'Explain the SAP estimation methodology'],
  adm:       ['How do I estimate an ADM project?', 'Show ADM rate card', 'Agile vs Waterfall estimation for ADM?'],
  itis:      ['How to estimate infrastructure sizing?', 'Show ITIS templates', 'Cloud vs on-premise cost estimation?'],
  bps:       ['How to estimate FTE-based services?', 'Show BPS SLA benchmarks', 'Automation impact on BPS estimates?'],
  ti:        ['How to estimate integration complexity?', 'Show TI templates', 'API vs middleware estimation approach?'],
  cyber:     ['How to estimate a SOC implementation?', 'Show Cyber Security templates', 'Penetration testing estimation?'],
  ai:        ['How do I estimate an AI/ML project?', 'Show AI case studies', 'GenAI implementation cost factors?'],
  datacloud: ['Cloud migration estimation approach?', 'Show cloud TCO templates', 'How to size a data warehouse?'],
  iae:       ['Legacy modernisation estimation?', 'Show IAE templates', 'How to estimate re-engineering effort?'],
};

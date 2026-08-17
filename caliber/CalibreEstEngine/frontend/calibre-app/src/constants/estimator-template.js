// ─── Oracle Fusion Template Estimator — reference data ───────────────────────
// Ported from the uploaded Oracle_Fusion_Estimator_v3_1.xlsx template (67
// bottom-up components + Section A parameters). Layer 1 (bottom-up effort,
// cost, role/FTE) computes client-side from this file — see useEstimator.js.
// Layer 2 (ML deviation/overrun risk) is scored server-side by the FastAPI
// estimator_agents service (trained on the real 500-project execution
// dataset); see useEstimator.js for that request/response contract.

export const COMPLEXITY_LEVELS = [
  { value: 'L', label: 'L — Low' },
  { value: 'M', label: 'M — Medium' },
  { value: 'H', label: 'H — High' },
  { value: 'VH', label: 'VH — Very High' },
];

// Must match estimator_agents/models/explainable_twin_coefficients.json's
// `industries` list exactly — the FastAPI /score endpoint 422s on anything
// outside this set since it's the ML model's trained category vocabulary.
export const INDUSTRIES = [
  'BFSI',
  'Consumer Goods',
  'Energy & Utilities',
  'Healthcare',
  'Logistics',
  'Manufacturing',
  'Professional Services',
  'Public Sector',
  'Retail',
  'Telecom',
];

// Applied as a multiplier to a component's unit_effort × volume (Layer 1).
export const COMPLEXITY_MULT = { L: 0.7, M: 1.0, H: 1.4, VH: 1.9 };

// NOTE: the rate card used to live here as RATE_CARD, but that meant every
// browser bundle shipped it — including to `estimator`/`senior_mgmt`, the two
// roles the whole restriction exists to protect from it. It now lives
// backend-only at backend/upload-server/estimator/rateCard.js, reachable only
// from Node. computeBottomUp() takes a rateCard argument instead of importing
// one; browser call sites simply have none to pass, by construction.

// Generic delivery risks that apply regardless of industry (from the
// uploaded template's own risk register — distinct from the ML model's
// per-project deviation/overrun risk scoring).
export const GENERIC_RISK_REGISTER = [
  { risk: 'Scope creep from undiscovered business requirements', category: 'Scope', probability: 'H', impact: 'H', effort_adder_pct: 10, mitigation: 'Fixed-scope SoW with change control; CRP gates' },
  { risk: 'Poor data quality in legacy systems requiring extensive cleanse', category: 'Data', probability: 'H', impact: 'H', effort_adder_pct: 15, mitigation: 'Data quality assessment in Phase 0; early profiling' },
  { risk: 'Client SME availability below 40% commitment', category: 'Resourcing', probability: 'H', impact: 'M', effort_adder_pct: 10, mitigation: 'Escalation path to Steering; contractual commitment' },
  { risk: 'Integration complexity higher than estimated (undiscovered APIs)', category: 'Integration', probability: 'M', impact: 'H', effort_adder_pct: 12, mitigation: 'Integration discovery workshop in Week 2' },
  { risk: 'Configuration decisions delayed beyond 5-day SLA', category: 'Governance', probability: 'M', impact: 'M', effort_adder_pct: 8, mitigation: 'Decision log; 48hr escalation to Programme Sponsor' },
  { risk: 'Regulatory change during project (tax, payroll legislation)', category: 'Regulatory', probability: 'M', impact: 'H', effort_adder_pct: 10, mitigation: 'Change control; buffer in payroll and tax streams' },
  { risk: 'Oracle Cloud quarterly update breaking custom configuration', category: 'Technical', probability: 'M', impact: 'M', effort_adder_pct: 5, mitigation: 'Regression test suite; Oracle release calendar monitoring' },
  { risk: 'Cutover complexity greater than estimated (data volumes/reconciliation)', category: 'Cutover', probability: 'M', impact: 'H', effort_adder_pct: 12, mitigation: 'Mock cutover rehearsal; 2 dry runs planned' },
];

export const SECTION_A_LABELS = {
  duration_months: 'Project Duration',
  n_modules: 'No. of Oracle Modules in Scope',
  n_entities: 'No. of Legal Entities / Countries',
  n_integrations: 'No. of Integrations (Interfaces)',
  n_dm_objects: 'No. of Data Migration Objects',
  n_reports: 'No. of Custom Reports / Analytics',
  n_cemli: 'No. of Custom Extensions (CEMLI)',
  integ_complex: 'No. of Integrations — Complex',
  integ_simple: 'No. of Integrations — Simple',
  contingency_pct: 'Contingency %',
  mgmt_reserve_pct: 'Management Reserve %',
  working_hours_day: 'Working Hours per Day',
  working_days_month: 'Working Days per Month',
  onshore_pct: 'Onshore %',
};

// value/min/max/unit — used to render the Section A input grid with sane defaults
export const SECTION_A_PARAMS = {
  duration_months: { value: 18, unit: 'months', min: 12, max: 36 },
  n_modules: { value: 5, unit: 'count', min: 1, max: 12 },
  n_entities: { value: 3, unit: 'count', min: 1, max: 50 },
  n_integrations: { value: 25, unit: 'count', min: 5, max: 150 },
  n_dm_objects: { value: 15, unit: 'count', min: 5, max: 120 },
  n_reports: { value: 40, unit: 'count', min: 10, max: 300 },
  n_cemli: { value: 10, unit: 'count', min: 0, max: 100 },
  integ_complex: { value: 8, unit: 'count', min: 0, max: 50 },
  integ_simple: { value: 17, unit: 'count', min: 0, max: 100 },
  contingency_pct: { value: 15, unit: '%', min: 10, max: 25 },
  mgmt_reserve_pct: { value: 5, unit: '%', min: 3, max: 10 },
  working_hours_day: { value: 8, unit: 'hrs', min: 7, max: 9 },
  working_days_month: { value: 20, unit: 'days', min: 18, max: 22 },
  onshore_pct: { value: 30, unit: '%', min: 0, max: 100 },
};

// 67 bottom-up components, grouped by module/pillar in template order.
// unit_effort is in days; default_volume/default_complexity seed the grid,
// primary_role is the template's real (not heuristic) role assignment.
export const COMPONENTS = [
  { module: 'HCM – Core HR', component: 'Enterprise Structures & Legal Entities', default_complexity: 'M', default_volume: 3.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'HCM – Core HR', component: 'Workforce Structures (Dept/Grade/Position)', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'HCM – Core HR', component: 'Employee Lifecycle Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },
  { module: 'HCM – Core HR', component: 'Absence Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },
  { module: 'HCM – Core HR', component: 'Document Management & Person Info', default_complexity: 'L', default_volume: 1.0, unit_effort: 5.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },

  { module: 'HCM – Payroll', component: 'Payroll Element Setup & Fast Formulas', default_complexity: 'H', default_volume: 1.0, unit_effort: 20.0, source: 'Everest 2023', primary_role: 'Functional Lead' },
  { module: 'HCM – Payroll', component: 'Payroll Run & Reconciliation', default_complexity: 'H', default_volume: 1.0, unit_effort: 18.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },
  { module: 'HCM – Payroll', component: 'Tax Localisation & Costing', default_complexity: 'H', default_volume: 3.0, unit_effort: 15.0, source: 'Gartner 2022', primary_role: 'Technical Developer' },

  { module: 'HCM – Talent', component: 'Recruitment & Candidate Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },
  { module: 'HCM – Talent', component: 'Performance Management & Goal Setting', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'HCM – Talent', component: 'Learning Management (OLM)', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },

  { module: 'HCM – Benefits', component: 'Benefit Plans & Eligibility', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },

  { module: 'ERP – Financials', component: 'General Ledger & Chart of Accounts', default_complexity: 'H', default_volume: 1.0, unit_effort: 18.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },
  { module: 'ERP – Financials', component: 'Accounts Payable', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'ERP – Financials', component: 'Accounts Receivable', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'ERP – Financials', component: 'Fixed Assets', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'ERP – Financials', component: 'Cash Management & Banking', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'Gartner 2022', primary_role: 'Functional Consultant' },
  { module: 'ERP – Financials', component: 'Intercompany & Consolidation', default_complexity: 'H', default_volume: 3.0, unit_effort: 20.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },
  { module: 'ERP – Financials', component: 'Tax (GTAX / Avalara Integration)', default_complexity: 'H', default_volume: 3.0, unit_effort: 15.0, source: 'Forrester TEI', primary_role: 'Technical Lead' },
  { module: 'ERP – Financials', component: 'Expense Management (OIE/iExpense)', default_complexity: 'L', default_volume: 1.0, unit_effort: 6.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },

  { module: 'ERP – Procurement', component: 'Purchasing & Sourcing', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'ERP – Procurement', component: 'Supplier Portal & Self-Service', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },
  { module: 'ERP – Procurement', component: 'Contract Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },

  { module: 'SCM', component: 'Inventory Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Lead' },
  { module: 'SCM', component: 'Order Management', default_complexity: 'H', default_volume: 1.0, unit_effort: 18.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },
  { module: 'SCM', component: 'Supply Chain Planning (SCP/S&OP)', default_complexity: 'H', default_volume: 1.0, unit_effort: 22.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },
  { module: 'SCM', component: 'Manufacturing (WIP/BOM/Routing)', default_complexity: 'H', default_volume: 1.0, unit_effort: 25.0, source: 'Everest 2023', primary_role: 'Functional Lead' },
  { module: 'SCM', component: 'Quality Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'SCM', component: 'Warehouse Management (WMS)', default_complexity: 'H', default_volume: 1.0, unit_effort: 20.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },
  { module: 'SCM', component: 'Procurement Contracts', default_complexity: 'L', default_volume: 1.0, unit_effort: 6.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },

  { module: 'CX – Sales', component: 'Opportunity & Pipeline Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },
  { module: 'CX – Sales', component: 'Configure Price Quote (CPQ)', default_complexity: 'H', default_volume: 1.0, unit_effort: 20.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },

  { module: 'CX – Service', component: 'Service Requests & Case Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },

  { module: 'CX – Marketing', component: 'Campaign & Lead Management (Eloqua)', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Forrester TEI', primary_role: 'Functional Consultant' },

  { module: 'EPM', component: 'Planning & Budgeting (EPBCS)', default_complexity: 'H', default_volume: 1.0, unit_effort: 25.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },
  { module: 'EPM', component: 'Financial Consolidation (FCCS)', default_complexity: 'H', default_volume: 1.0, unit_effort: 22.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },
  { module: 'EPM', component: 'Account Reconciliation (ARCS)', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Functional Consultant' },
  { module: 'EPM', component: 'Profitability & Cost Management (PCM)', default_complexity: 'H', default_volume: 1.0, unit_effort: 18.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },

  { module: 'Integration', component: 'REST/SOAP API Integrations (Simple)', default_complexity: 'M', default_volume: 17.0, unit_effort: 6.0, source: 'Everest 2023', primary_role: 'Technical Lead' },
  { module: 'Integration', component: 'Real-Time / Event-Driven Integrations (Complex)', default_complexity: 'H', default_volume: 8.0, unit_effort: 14.0, source: 'Forrester TEI', primary_role: 'Technical Lead' },
  { module: 'Integration', component: 'OIC Flow Design & Orchestration', default_complexity: 'M', default_volume: 1.0, unit_effort: 15.0, source: 'Everest 2023', primary_role: 'Technical Lead' },
  { module: 'Integration', component: 'Legacy ERP / Custom App Integration', default_complexity: 'H', default_volume: 5.0, unit_effort: 18.0, source: 'Forrester TEI', primary_role: 'Technical Lead' },

  { module: 'Data Migration', component: 'Data Extraction & Profiling', default_complexity: 'M', default_volume: 1.0, unit_effort: 12.0, source: 'Everest 2023', primary_role: 'Data Migration Specialist' },
  { module: 'Data Migration', component: 'Data Cleansing & Transformation', default_complexity: 'H', default_volume: 1.0, unit_effort: 18.0, source: 'Forrester TEI', primary_role: 'Data Migration Specialist' },
  { module: 'Data Migration', component: 'FBDI/HDL Template Build (per object)', default_complexity: 'M', default_volume: 15.0, unit_effort: 4.0, source: 'Everest 2023', primary_role: 'Technical Developer' },
  { module: 'Data Migration', component: 'Migration Trial Loads & Reconciliation', default_complexity: 'H', default_volume: 1.0, unit_effort: 15.0, source: 'Gartner 2022', primary_role: 'Data Migration Specialist' },
  { module: 'Data Migration', component: 'Cutover Plan & Execution', default_complexity: 'H', default_volume: 1.0, unit_effort: 10.0, source: 'Everest 2023', primary_role: 'Project Manager' },

  { module: 'Reporting', component: 'OTBI/BIP Standard Reports', default_complexity: 'L', default_volume: 20.0, unit_effort: 1.5, source: 'Everest 2023', primary_role: 'Technical Developer' },
  { module: 'Reporting', component: 'Custom BI Reports (complex)', default_complexity: 'H', default_volume: 10.0, unit_effort: 5.0, source: 'Forrester TEI', primary_role: 'Technical Developer' },
  { module: 'Reporting', component: 'OTBI Subject Area Extension', default_complexity: 'H', default_volume: 5.0, unit_effort: 6.0, source: 'Gartner 2022', primary_role: 'Technical Lead' },
  { module: 'Reporting', component: 'Oracle Analytics Cloud (OAC) Dashboards', default_complexity: 'H', default_volume: 8.0, unit_effort: 8.0, source: 'Gartner 2022', primary_role: 'Technical Lead' },

  { module: 'Security', component: 'Role Design & RBAC Model', default_complexity: 'H', default_volume: 1.0, unit_effort: 20.0, source: 'Gartner 2022', primary_role: 'Functional Lead' },
  { module: 'Security', component: 'User Provisioning & SSO', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Everest 2023', primary_role: 'Technical Lead' },
  { module: 'Security', component: 'SoD Conflict Analysis & Remediation', default_complexity: 'H', default_volume: 1.0, unit_effort: 15.0, source: 'Forrester TEI', primary_role: 'Functional Lead' },

  { module: 'Testing & QA', component: 'Test Strategy & Test Plan', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'SFIA v8', primary_role: 'Testing Lead' },
  { module: 'Testing & QA', component: 'Test Script Development', default_complexity: 'M', default_volume: 1.0, unit_effort: 20.0, source: 'SFIA v8', primary_role: 'Functional Consultant' },
  { module: 'Testing & QA', component: 'System Integration Testing (SIT)', default_complexity: 'H', default_volume: 1.0, unit_effort: 25.0, source: 'Everest 2023', primary_role: 'Testing Lead' },
  { module: 'Testing & QA', component: 'User Acceptance Testing (UAT) Facilitation', default_complexity: 'M', default_volume: 1.0, unit_effort: 20.0, source: 'SFIA v8', primary_role: 'Testing Lead' },
  { module: 'Testing & QA', component: 'Performance & Load Testing', default_complexity: 'H', default_volume: 1.0, unit_effort: 15.0, source: 'Gartner 2022', primary_role: 'Technical Lead' },

  { module: 'OCM & Training', component: 'Change Impact Assessment', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'Prosci/ACMP', primary_role: 'Change Management Lead' },
  { module: 'OCM & Training', component: 'Stakeholder Engagement & Comms', default_complexity: 'M', default_volume: 1.0, unit_effort: 15.0, source: 'Prosci/ACMP', primary_role: 'Change Management Lead' },
  { module: 'OCM & Training', component: 'End-User Training Delivery', default_complexity: 'M', default_volume: 1.0, unit_effort: 15.0, source: 'Prosci/ACMP', primary_role: 'Functional Consultant' },

  { module: 'Programme Mgmt', component: 'Project Management (end-to-end)', default_complexity: 'H', default_volume: 1.0, unit_effort: 30.0, source: 'PMI PMBOK', primary_role: 'Project Manager' },
  { module: 'Programme Mgmt', component: 'Governance & Steering', default_complexity: 'M', default_volume: 1.0, unit_effort: 10.0, source: 'PMI PMBOK', primary_role: 'Programme Director' },
  { module: 'Programme Mgmt', component: 'Risk & Issue Management', default_complexity: 'M', default_volume: 1.0, unit_effort: 8.0, source: 'PMI PMBOK', primary_role: 'Project Manager' },
  { module: 'Programme Mgmt', component: 'Architecture Governance & Reviews', default_complexity: 'H', default_volume: 1.0, unit_effort: 12.0, source: 'Gartner 2022', primary_role: 'Solution Architect' },
  { module: 'Programme Mgmt', component: 'Infrastructure & Cloud Setup (OCI)', default_complexity: 'H', default_volume: 1.0, unit_effort: 15.0, source: 'Everest 2023', primary_role: 'Infrastructure Engineer' },
];

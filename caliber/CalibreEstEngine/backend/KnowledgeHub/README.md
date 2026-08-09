# Calibre KnowledgeHub

Central repository for all estimation knowledge assets, organised by **Business Unit (BU)**.

---

## Folder Structure

```
KnowledgeHub/
├── _global/       ← COE-owned global assets
│   ├── templates/ ← Master estimation templates
│   └── data/      ← Global rate-cards, benchmarks, context, and other materials
│
├── ESU/           ← Enterprise Solutions Unit
│   ├── templates/
│   └── data/
│
├── ADM/           ← Application Development & Maintenance
│   ├── templates/
│   └── data/
│
├── ITIS/          ← IT Infrastructure & Services
│   ├── templates/
│   └── data/
│
├── BPS/           ← Business Process Services
│   ├── templates/
│   └── data/
│
├── TI/            ← Technology Integration
│   ├── templates/
│   └── data/
│
├── iON/           ← iON Mid-market / SMB SaaS
│   ├── templates/
│   └── data/
│
└── BFSI/          ← Banking, Financial Services & Insurance
    ├── templates/
    └── data/
```

Each BU folder contains:
| Subfolder | Purpose | Who Uploads | Who Publishes |
|-----------|---------|-------------|---------------|
| `templates/` | Estimation templates (XLSX, templates) | Super User | Admin / COE |
| `data/` | Rate-cards, Benchmarks, POVs, Case Studies, and other knowledge articles | Super User / Admin | Admin / COE |

---

## Naming Convention

```
{BU}_{Folder}_{Name}_{Version}_{YYYY-MM}.{ext}

Examples:
  ESU_templates_OracleFusion_v2_2026-07.xlsx
  ADM_data_JavaDevRateCard_v1_2026-07.xlsx
  _global_data_EstimationStandards_v3_2026-07.pdf
```

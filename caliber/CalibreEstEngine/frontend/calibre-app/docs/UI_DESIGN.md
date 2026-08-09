# Calibre Estimation Engine — UI Design Document

**Scope:** `calibre-app/` (React 19 + Vite SPA) and its companion `upload-server/`.
**Audience:** designers and engineers extending the Calibre frontend.
**Method:** derived from the current source (components, constants, styles) and a live walkthrough of the running app (`npm run dev`, port 5173) on 2026-07-28.

---

## 1. What Calibre is

Calibre is an internal estimation platform (TCS-branded) for scoping software delivery work. It's built around one premise: **every screen adapts to a role**, not just through hidden/shown buttons but through a distinct hero message, KPI set, and access mode per workflow. A persistent AI assistant, **EVA**, sits on every screen as a second, conversational way to reach the same functionality.

Two things anchor the whole product:

1. **Role-based experience, not role-based permissions bolted on.** The 5 roles (Admin/COE, Super User, Unit SME, Senior Management, Estimator) each get their own greeting, KPIs, and per-card access mode (`full` / `unit` / `review` / `comment` / `self` / `readonly` / `locked`) — defined once in [`constants/roles.js`](../src/constants/roles.js) and consumed everywhere.
2. **EVA as a parallel UI, not a chatbot bolted on.** Every page passes context into a shared `EVA` state (`useEVA`); "Ask EVA" affordances appear inside Knowledge Hub cards, workflow locks, and detail modals, always opening the same panel rather than a per-feature dialog.

---

## 2. Tech stack & codebase map

| Layer | Choice |
|---|---|
| Framework | React 19, Vite 8, `react-router-dom` 7 (client-side routing, no SSR) |
| Icons | `@tabler/icons-react` exclusively — no other icon set |
| Styling | Hand-written CSS per feature area (no Tailwind/CSS-in-JS), one global token sheet |
| State | React Context (`RoleContext`) + local hooks (`useEVA`, `useKnowledgeHub`, `useUpload`) — no Redux/Zustand |
| Backend for uploads | Separate Node service, `upload-server/index.js`, writes into `/KnowledgeHub/<BU>/...` on disk |
| Data | Everything is **mocked in constants files** (`business-units.js`, `roles.js`, `knowledge-content.js`, `workflows.js`) — there is no API layer yet |

```
calibre-app/src/
├─ components/
│  ├─ layout/      TopBar, ManageUsersPanel
│  ├─ login/       LoginPage
│  ├─ home/        HeroBanner, WorkflowGrid, WorkflowCard, ActivityFeed, StatsStrip, KPIPill
│  ├─ eva/         EVA (FAB), EVAPanel, EVAAvatar, EVAMessageBubble, EVASuggestions, EVAInput, EVAVoiceMode
│  ├─ knowledge/   16 components for the Knowledge Hub (sidebar, grid, modals, upload wizard, right panel)
│  └─ common/      Toast
├─ pages/          KnowledgeHubPage, ROICostCalculatorPage
├─ contexts/       RoleContext
├─ hooks/          useEVA, useKnowledgeHub, useUpload, useAnimatedCounter, useVoice
├─ constants/      roles, business-units, subdivisions, workflows, knowledge-content, eva-responses, activity
└─ styles/         index.css (tokens), + one .css file per feature area
```

---

## 3. Information architecture

```
/                     → redirects to /login
/login                → role + department picker (entry point, no auth)
/home                 → TopBar + HeroBanner + WorkflowGrid + ActivityFeed + StatsStrip
/estimate/guide        → Knowledge Hub (Workflow 01)
/estimate/roi-cost     → ROI & AI Cost Computation Engine (Workflow 05)
*                     → redirects to /login
```

**Implementation status of the 5 workflow cards** (this matters — see §8.1 for detail):

| # | Card | Route it links to | Actually implemented? |
|---|---|---|---|
| 01 | What / How to Estimate | `/estimate/guide` | ✅ Knowledge Hub |
| 02 | Estimate / Re-estimate / View | `/estimate/create` | ❌ not routed — falls through to `/login` |
| 03 | Compare Against Benchmarks | `/estimate/benchmark` | ❌ not routed |
| 04 | Calibrate Your Estimation Engine | `/calibrate` | ❌ not routed |
| 05 | ROI & AI Cost Computation | `/estimate/roi-cost` | ✅ ROI Calculator |

There is no real authentication: `/login` is a **role simulator** — picking a role/department just sets context state and navigates to `/home`. "Sign Out" (TopBar user menu) returns to `/login` but doesn't clear the selection, so the previous role/department is still pre-selected.

---

## 4. Visual language

Calibre's identity is **dark glassmorphism on deep navy, with gold as the single brand accent** — a deliberate departure from the "purple-blue gradient on white" SaaS default. Every other hue (cyan, green, amber, purple, teal, violet) is reserved for *semantic* or *role* coding, never used as a second brand color.

### 4.1 Color tokens (`styles/index.css`)

| Token | Hex / value | Used for |
|---|---|---|
| `--bg` | `#040D1E` | App background — near-black navy |
| `--surface-1…4` | `#071530 → #1A3068` | Ascending elevation: card → card-hover → modal → active |
| `--border` / `--border-strong` / `--border-hover` | white @ 7% / 14% / 22% | Hairlines, always on translucent white, never a flat gray |
| `--text-primary` | `#EDF2F7` | Body/headings |
| `--text-secondary` | `#94A8C0` | Supporting text |
| `--text-muted` | `#4A6080` | Timestamps, placeholders |
| `--gold` / `--cyan`* | `#F5A400` | **The** brand accent — CTAs, active nav, hero titles |
| `--eva` / `--eva-2` | `#7C6FFF` → `#5B8EFF` | EVA-only gradient, never used elsewhere |
| `--green` | `#34D399` | Success, Estimator role |
| `--amber` | `#FFB347` | ITIS unit, accuracy KPI |
| `--purple` | `#A78BFA` | Super User role, pending reviews |
| `--teal` | `#2DD4BF` | TI unit, FAQ content type |
| `--danger` | `#F87171` | Destructive actions, red bar comparisons |

\* `--cyan` is a legacy alias that actually resolves to gold — a sign the palette was repointed from a cyan concept to the current TCS-gold identity without a full rename pass (see §8.2).

Every colored surface follows the same formula: **12% tint background + 35% tint border + full-strength text**, e.g. `--gold-bg: rgba(245,164,0,0.12)` / `--gold-border: rgba(245,164,0,0.35)`. This one formula is reused for role badges, content-type badges, classifier tags, and status pills — it's the single biggest consistency device in the app.

### 4.2 Typography

- **Inter** (400/500/600/700/800) — UI and body text throughout.
- **JetBrains Mono** — reserved for anything numeric-adjacent-to-code: classifier tags, role labels in the user chip (`ADMIN / COE`), monospace utility class.
- Base body size is **14px**, `line-height: 1.6` — a dense, data-tool register rather than an editorial one.

### 4.3 Shape, elevation, motion

- Radius scale: `--r-sm 6px / --r-md 10px / --r-lg 14px / --r-xl 20px / --r-full`. Cards use `lg`, pills use `full`.
- `.glass` utility: `rgba(21,34,56,0.75)` + `backdrop-filter: blur(16px)` — used for the EVA panel, modals, and the TopBar.
- A **21-entry keyframe library** in `index.css` drives nearly every animated moment in the app by name: `evaBreath` (idle avatar), `ringRotate` / `ringRotateReverse` (EVA's counter-rotating rings), `fabSpringIn`, `staggerFadeUp` (card load-in), `orbFloat` (login background), `voicePulse`, `toastIn/Out`. Centralizing these means every "thinking", "arriving", or "pulsing" state in the app reads the same way.

---

## 5. Role-based access model

### 5.1 The five roles

| Role | Scope | Accent | Baseline capability |
|---|---|---|---|
| **Admin / COE** | global | Cyan `#00D4FF` | Full platform access + calibration & governance |
| **Super User** | unit | Purple `#A78BFA` | Unit-wide review, approve, upload templates |
| **Unit SME** | unit | Amber `#FFB347` | Review templates/estimates, give feedback |
| **Senior Management** | unit | Gold `#F5A400` | View program estimates, comment only |
| **Estimator** | self | Green `#34D399` | Create/re-estimate/view **own** estimates only |

Note the role accent palette is independent of the brand-gold token below — Admin's cyan is a literal hex on the role object, not the `--cyan` CSS variable (which, confusingly, resolves to gold — see §8.2).

Roles are explicitly **additive**: "Estimator is the universal baseline" (comment in `roles.js`) — every other role is a superset of estimator capability plus governance powers, not a parallel track.

### 5.2 Permission matrix (`PERMISSIONS` in `roles.js`)

29 granular permission keys grouped into 7 domains: Context & Knowledge, Estimation, Benchmarking, Calibration Engine, ROI & Cost, User & Governance, EVA Assistant. Pattern worth calling out: almost every domain has a `*.own` / `*.unit` / `*.global` triad (e.g. `estimate.view.own/unit/global`), so scope is a first-class dimension alongside the permission itself — this is what lets one card render three different data sets for three different roles without three different components.

### 5.3 Card access modes

Each of the 5 home-screen workflow cards resolves to a **mode string** per role (`full | unit | review | comment | self | readonly | locked`), not just a boolean. `WorkflowCard.jsx` reads this to show role-specific badges:

- Locked cards show a lock icon + "Admin / SME only".
- Card 02 shows an **"Approval Queue"** badge only for Super User.
- Cards 04/05 show an **"SME Access"** badge (green) instead of a lock for SME — an SME is unlocked here even though Senior Management and Estimator are not, which is easy to miss if you only skim the lock icon.
- Clicking a locked card doesn't just no-op — it opens EVA with a role-aware "you don't have access" message (`onLockedCardClick` → `sendRestrictedMessage`), turning a dead-end into a conversation.

---

## 6. Screen-by-screen

### 6.1 Login (`/login`)

Split-screen layout: left is brand storytelling (tagline, 3 feature bullets, an idle EVA avatar teaser), right is a floating glass card with the actual picker. Three floating blurred orbs (`orbFloat` keyframe) drift behind everything for depth without motion sickness — they're large, slow, and low-opacity.

The role picker is 5 clickable cards (not a `<select>`), each showing icon + label + one-line description + role color — the same visual grammar the TopBar role switcher reuses later, so the mental model ("role = a color + an icon") is set on the very first screen. CTA button copy changes to reflect the selection: *"Enter Calibre as Admin / COE →"*.

### 6.2 Home (`/home`)

```
TopBar  (brand · role switcher · dept toggle | Manage Users · bell · settings · user menu)
HeroBanner  (greeting + role title + role message  |  3 animated KPI pills)
WorkflowGrid  (5 cards, 3+2 layout, role-aware lock/badge state)
ActivityFeed  (recent cross-role activity log)
StatsStrip  (secondary metric strip)
```

TopBar is the one element present on every authenticated screen. Its role switcher is a live `role="tablist"` — switching role doesn't navigate, it re-renders the whole Home page in place (hero message, KPIs, and card locks all update), which is how the app demonstrates "5 distinct experiences" from a single screen without needing 5 logins.

The **KPI pills** count up on mount/role-switch via `useAnimatedCounter` with staggered delays (100/200/300ms) — a small but deliberate detail that makes a role switch *feel* like new data arrived, not just new copy.

### 6.3 Knowledge Hub (`/estimate/guide`)

The most structurally complex screen — a 3-panel workspace:

```
KHPageHeader   (breadcrumb · search overlay · subdivision tabs · view toggle · Upload button)
┌─────────────┬───────────────────────────────┬──────────────┐
│ KHSidebar    │  KHCenter                     │ KHRightPanel │
│ · All Units  │  KHAllUnitsView  (9 BU tiles) │ (item detail │
│ · 9 BUs      │   — or, if a BU is selected — │  / EVA hooks)│
│ · categories │  KHBUHero → SubdivisionNav →  │              │
│   (Guidelines,│  ProgramTypeFilter → ContentGrid            │
│   Templates…) │                                │              │
└─────────────┴───────────────────────────────┴──────────────┘
```

Key taxonomy (see §7 for full tables):
- **9 Business Units** (ESU, ADM, ITIS, BPS, TI, Cyber Security, AI, Data & Cloud, IAE), each with its own accent color and set of valid *program types*.
- **7 subdivisions** (Guidelines, Templates, Playbooks/Videos, FAQs, Points of View, Case Studies, **Data** — the last restricted to `admin` + `sme` only, enforced via `restrictedToRoles` in `subdivisions.js`).
- **8 content types**, each with a color, and **7 file-type badges** (pdf/xlsx/docx/pptx/csv/mp4/zip), each with its own icon+color — so a card communicates unit, content type, and file type through three independent, non-competing color cues rather than one overloaded badge.

Content cards support both a grid and list view (`viewMode` toggle), can be selected (opens right panel), previewed (opens `KHDetailModal`), downloaded (spawns a `KHDownloadToast`), or escalated to EVA with pre-filled context ("Tell me about *X*...").

**Upload wizard** (`KHUploadModal`, admin/super only — gated by `context.upload.global` / `context.upload.unit`): a 3-step flow with a persistent step indicator —

1. **Select File** — drag/drop zone (`KHUploadDropZone`)
2. **Metadata** — title, type, BU, description, tags, version (`KHUploadMetaForm`)
3. **Preview & Publish** — renders the *actual* `KHContentCard` component with the entered data, so what you see is genuinely what will appear in the grid, not a stylized mock.

On submit, the browser posts to the sibling **upload-server** (`upload-server/index.js`), which routes the file into `KnowledgeHub/<BU-code>/...` on disk (recent commits: BU-scoped folders + an `Others` subfolder per BU).

### 6.4 ROI & AI Cost Computation Engine (`/estimate/roi-cost`)

A single-purpose calculator page, structurally simpler than Knowledge Hub: header with back button → **4 KPI cards** (Annual Net Benefit, ROI Multiplier, Monthly Hours Saved, Monthly AI API Cost) → a two-column body of **sliders** (left) driving a **bar comparison + cost ledger table** (right, live-recomputed via `useMemo`).

Inputs: proposals/month, RAG queries/proposal, hourly rate, manual vs. AI-assisted hours, LLM model tier (GPT-4o-mini / GPT-4o / Claude 3.5 Sonnet, with real per-model token pricing), and a **Hybrid vs. Standard RAG architecture** toggle that changes the token-cost math (2,000/500 tokens vs. 15,000/800 tokens per query). This toggle is the page's one genuinely technical idea: it's letting a non-engineer estimator feel the cost impact of a RAG chunking decision, which is normally invisible to them.

*Observation:* at low `totalAiCost` (e.g. cheap model + few proposals), `roiMultiplier = laborSavings / totalAiCost` can spike to absurd values (5-figure ×) because the denominator approaches zero — worth capping or reframing as "cost as % of labor saved" if this ships beyond a demo.

### 6.5 Manage Users panel (Admin/COE only)

A slide-in panel (not a route — opened from a `Manage Users` chip that only Admin/COE sees in the TopBar), full CRUD over a mock user list:

- **Role summary strip**: 5 clickable pills, each showing role icon/color + live count, doubling as a role filter.
- **Toolbar**: search (name/email) + BU filter + status filter (active/inactive/pending).
- **Table**: avatar-initials, role badge, unit tag, status dot (green/gray/amber), last-active, and a row action menu (Edit / Activate-Deactivate / Remove).
- **Add/Edit modal**: role assignment reuses the same icon+color role-button grammar as Login and TopBar — the third distinct place this pattern appears, reinforcing it as the app's signature control for "pick a role."

All CRUD is local `useState` — no backend for user management yet.

### 6.6 EVA — the assistant layer

EVA is not page-scoped: a single `useEVA()` instance is created once in `App.jsx` and threaded into every route plus the global FAB, so chat history and open/closed state survive navigation. The FAB shows a breathing avatar + green "online" dot; the panel is a glass sidebar with:

- **Mode bar**: Chat / Voice tabs (voice mode is a separate `EVAVoiceMode` component with a pulsing orb and waveform bars).
- **Message list** with role-colored avatars and a 3-dot typing indicator (own bounce keyframe) during "thinking."
- **Contextual suggestion chips** that change per page (Knowledge Hub injects "Tell me about *X*" prompts; Home shows generic estimation questions).
- Cross-component injection via a `window.dispatchEvent(new CustomEvent('eva:inject', ...))` pattern — any component can push a message into EVA without prop-drilling through the whole tree, at the cost of being a global, untyped side channel (see §8.2).

---

## 7. Content taxonomy reference

**Business Units** (`business-units.js`) — each carries its own hex accent, icon, and a whitelist of valid *program types* used to power the program-type filter inside a unit:

| Code | Full name | Program types |
|---|---|---|
| ESU | Enterprise Solutions Unit | oracle, sap, peoplesoft, servicenow, salesforce |
| ADM | App Development & Maintenance | oracle, java, dotnet, python, agile |
| ITIS | IT Infrastructure & Services | server, network, storage, cloud, enduser |
| BPS | Business Process Services | finance-accounting, hr, customer-ops, supply-chain |
| TI | Technology Integration | mulesoft, boomi, azure-apim, api-rest |
| Cyber Security | Cyber Security | soc, iam, penetration-testing, compliance, zero-trust |
| AI | Artificial Intelligence Practice | ml, genai, nlp, computer-vision, mlops |
| Data & Cloud | Data & Cloud Services | aws, azure, gcp, data-engineering, analytics |
| IAE | Integrated Application Engineering | servicenow, outsystems, pega, legacy-modernisation |

**Content types**: Guideline, Template, Data, Point of View, FAQ, Case Study, Playbook, Training Video — each own color, used as a badge independent of the BU color.

---

## 8. Notes for whoever picks this up next

### 8.1 Known implementation gaps
- Workflow cards **02, 03, 04** are visually "unlocked" for most roles but route to paths (`/estimate/create`, `/estimate/benchmark`, `/calibrate`) that don't exist in `App.jsx`'s `<Routes>` — the router's catch-all silently bounces the user back to `/login`. Only cards **01** (Knowledge Hub) and **05** (ROI Calculator) are real screens today. Anyone demoing this should route around cards 02–04, or stub placeholder pages before a live demo.
- "Sign Out" clears nothing — it's a navigation, not a session reset. Fine for a prototype, worth flagging before this is mistaken for real auth.
- No backend for estimates, calibration, benchmarks, or user management — all mock data in `constants/`. Only the Knowledge Hub upload path talks to a real service (`upload-server`).

### 8.2 Naming/consistency debt
- `--cyan` in `index.css` is aliased to the gold hex (`#F5A400`) — a leftover from an earlier cyan-accent concept, and confusingly it coexists with a *real* cyan (`#00D4FF`) that's hardcoded directly on the Admin role object and the ESU business unit. So "cyan" means two different colors depending on whether you're reading the token sheet or `roles.js`/`business-units.js`. Anyone touching the token file should either rename `--cyan` to something honest (it's used by `.badge-cyan`, `.glow-cyan`, `.classifier-tag.t1` — all effectively gold today) or reintroduce a real cyan token and repoint the admin/ESU hexes to it.
- The `eva:inject` global `CustomEvent` is the only non-React-state communication channel in the app. It works, but it's untyped and undiscoverable by grep-for-props; if EVA's injection surface grows, consider moving it into the shared `useEVA` hook's return API instead.

### 8.3 What's worth preserving as the app grows
- The **12%-tint-bg / 35%-tint-border / full-strength-text** badge formula — reuse it for any new status/tag, don't invent a second pattern.
- The **role = icon + color** grammar (Login → TopBar → Manage Users) — keep any future role-facing UI consistent with it.
- EVA's context-injection convention (open panel, then send a pre-filled message) for "ask AI about this specific thing" — already used from Knowledge Hub cards, locked workflow cards, and the detail modal; extend it rather than adding a fourth alternative pattern.

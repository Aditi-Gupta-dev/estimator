import { useState, useMemo } from 'react';
import '../styles/roi-calculator.css';
import {
  IconCalculator,
  IconChartBar,
  IconCoin,
  IconClock,
  IconTrendingUp,
  IconCpu,
  IconLayersSubtract,
  IconHelpCircle,
  IconArrowLeft,
  IconDownload,
  IconSparkles,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

const MODEL_PRICING = {
  'gpt4o-mini': {
    name: 'OpenAI GPT-4o-mini (Default)',
    embed: 0.02,
    input: 0.15,
    output: 0.60,
  },
  'gpt4o': {
    name: 'OpenAI GPT-4o (High Accuracy)',
    embed: 0.02,
    input: 2.50,
    output: 10.00,
  },
  'claude-sonnet': {
    name: 'Claude 3.5 Sonnet',
    embed: 0.02,
    input: 3.00,
    output: 15.00,
  },
};

export function ROICostCalculatorPage() {
  const navigate = useNavigate();

  // ── Form State ────────────────────────────────────────────────────────────
  const [proposalsCount, setProposalsCount] = useState(25);
  const [queriesPerProposal, setQueriesPerProposal] = useState(15);
  const [hourlyRate, setHourlyRate] = useState(85);
  const [manualHours, setManualHours] = useState(16);
  const [aiHours, setAiHours] = useState(2);
  const [selectedModelKey, setSelectedModelKey] = useState('gpt4o-mini');
  const [chunkStrategy, setChunkStrategy] = useState('hybrid'); // 'hybrid' | 'legacy'

  // ── Computation Engine ───────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const model = MODEL_PRICING[selectedModelKey];
    const totalQueries = proposalsCount * queriesPerProposal;

    // Tokens per query
    const isHybrid = chunkStrategy === 'hybrid';
    const inputTokensPerQuery = isHybrid ? 2000 : 15000;
    const outputTokensPerQuery = isHybrid ? 500 : 800;

    const monthlyInputTokens = totalQueries * inputTokensPerQuery;
    const monthlyOutputTokens = totalQueries * outputTokensPerQuery;
    const monthlyEmbedTokens = proposalsCount * 10 * 20000; // ~10 docs uploaded per proposal

    // API Cost
    const embedCost = (monthlyEmbedTokens / 1_000_000) * model.embed;
    const inputCost = (monthlyInputTokens / 1_000_000) * model.input;
    const outputCost = (monthlyOutputTokens / 1_000_000) * model.output;
    const totalAiCost = embedCost + inputCost + outputCost;

    // Labor Cost & Savings
    const manualLaborCost = proposalsCount * manualHours * hourlyRate;
    const aiLaborCost = proposalsCount * aiHours * hourlyRate;
    const laborSavings = manualLaborCost - aiLaborCost;
    const hoursSavedTotal = proposalsCount * (manualHours - aiHours);

    // Financial ROI
    const netMonthlyBenefit = laborSavings - totalAiCost;
    const annualNetBenefit = netMonthlyBenefit * 12;
    const roiMultiplier = totalAiCost > 0 ? laborSavings / totalAiCost : 0;
    const roiPercent = totalAiCost > 0 ? ((laborSavings - totalAiCost) / totalAiCost) * 100 : 0;

    // Legacy vs Hybrid comparison delta
    const legacyInputTokens = totalQueries * 15000;
    const legacyCost = (monthlyEmbedTokens / 1_000_000) * model.embed +
                       (legacyInputTokens / 1_000_000) * model.input +
                       (totalQueries * 800 / 1_000_000) * model.output;
    const tokenSavingsPercent = ((legacyCost - totalAiCost) / legacyCost) * 100;

    return {
      totalQueries,
      totalAiCost,
      embedCost,
      inputCost,
      outputCost,
      manualLaborCost,
      aiLaborCost,
      laborSavings,
      hoursSavedTotal,
      netMonthlyBenefit,
      annualNetBenefit,
      roiMultiplier,
      roiPercent,
      tokenSavingsPercent: Math.max(0, tokenSavingsPercent),
      legacyCost,
    };
  }, [proposalsCount, queriesPerProposal, hourlyRate, manualHours, aiHours, selectedModelKey, chunkStrategy]);

  const fmtCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  const fmtNumber = (val) => new Intl.NumberFormat('en-US').format(Math.round(val));

  return (
    <div className="roi-page" id="roi-calculator-page">
      {/* Top Header */}
      <header className="roi-header">
        <div className="roi-title-group">
          <h1>
            <button className="kh-view-btn" onClick={() => navigate('/home')} style={{ marginRight: 8 }}>
              <IconArrowLeft size={16} />
            </button>
            <IconTrendingUp size={24} color="var(--gold)" />
            ROI & AI Cost Computation Engine
            <span className="roi-title-badge">TRIGGER 06</span>
          </h1>
          <p className="roi-subtitle">
            Evaluate infrastructure token costs, RAG efficiency savings, and financial return on investment for Calibre AI estimation workflows.
          </p>
        </div>
        <div className="roi-header-actions">
          <button className="kh-upload-btn" onClick={() => window.print()}>
            <IconDownload size={14} />
            Export ROI Report
          </button>
        </div>
      </header>

      {/* KPI Highlight Strip */}
      <div className="roi-kpi-grid">
        <div className="roi-kpi-card">
          <div className="roi-kpi-label">
            <span>Annual Net Benefit</span>
            <IconCoin size={16} color="var(--gold)" />
          </div>
          <div className="roi-kpi-value gold">{fmtCurrency(metrics.annualNetBenefit)}</div>
          <div className="roi-kpi-sub positive">
            <IconTrendingUp size={12} />
            Net return after AI infrastructure expenses
          </div>
        </div>

        <div className="roi-kpi-card">
          <div className="roi-kpi-label">
            <span>ROI Multiplier</span>
            <IconSparkles size={16} color="#34D399" />
          </div>
          <div className="roi-kpi-value">{metrics.roiMultiplier.toFixed(1)}x</div>
          <div className="roi-kpi-sub positive">
            {fmtNumber(metrics.roiPercent)}% return on AI spend
          </div>
        </div>

        <div className="roi-kpi-card">
          <div className="roi-kpi-label">
            <span>Monthly Hours Saved</span>
            <IconClock size={16} color="#A78BFA" />
          </div>
          <div className="roi-kpi-value">{fmtNumber(metrics.hoursSavedTotal)} hrs</div>
          <div className="roi-kpi-sub">
            From {manualHours}h down to {aiHours}h per proposal
          </div>
        </div>

        <div className="roi-kpi-card">
          <div className="roi-kpi-label">
            <span>Monthly AI API Cost</span>
            <IconCpu size={16} color="#FF6B6B" />
          </div>
          <div className="roi-kpi-value">{fmtCurrency(metrics.totalAiCost)}</div>
          <div className="roi-kpi-sub positive">
            {chunkStrategy === 'hybrid' ? `${metrics.tokenSavingsPercent.toFixed(0)}% token cost reduction vs standard RAG` : 'Standard token footprint'}
          </div>
        </div>
      </div>

      {/* Main Grid: Controls + Visual Analytics */}
      <div className="roi-main-grid">
        {/* Controls Card */}
        <aside className="roi-controls-card">
          <h2 className="roi-section-h2">
            <IconLayersSubtract size={18} color="var(--gold)" />
            Estimation Parameters
          </h2>

          {/* Proposals / Month */}
          <div className="roi-field-group">
            <div className="roi-field-label">
              <span>Proposals per Month</span>
              <span className="roi-field-value-badge">{proposalsCount} proposals</span>
            </div>
            <input
              type="range"
              className="roi-slider"
              min={5}
              max={150}
              step={5}
              value={proposalsCount}
              onChange={(e) => setProposalsCount(Number(e.target.value))}
            />
          </div>

          {/* RAG Queries / Proposal */}
          <div className="roi-field-group">
            <div className="roi-field-label">
              <span>RAG Queries per Proposal</span>
              <span className="roi-field-value-badge">{queriesPerProposal} queries</span>
            </div>
            <input
              type="range"
              className="roi-slider"
              min={5}
              max={50}
              step={1}
              value={queriesPerProposal}
              onChange={(e) => setQueriesPerProposal(Number(e.target.value))}
            />
          </div>

          {/* Hourly Rate */}
          <div className="roi-field-group">
            <div className="roi-field-label">
              <span>Estimator Rate ($/hr)</span>
              <span className="roi-field-value-badge">${hourlyRate}/hr</span>
            </div>
            <input
              type="range"
              className="roi-slider"
              min={40}
              max={250}
              step={5}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Number(e.target.value))}
            />
          </div>

          {/* Manual Effort */}
          <div className="roi-field-group">
            <div className="roi-field-label">
              <span>Manual Time per Estimate</span>
              <span className="roi-field-value-badge">{manualHours} hrs</span>
            </div>
            <input
              type="range"
              className="roi-slider"
              min={4}
              max={40}
              step={1}
              value={manualHours}
              onChange={(e) => setManualHours(Number(e.target.value))}
            />
          </div>

          {/* AI Effort */}
          <div className="roi-field-group">
            <div className="roi-field-label">
              <span>Calibre AI-Assisted Time</span>
              <span className="roi-field-value-badge">{aiHours} hrs</span>
            </div>
            <input
              type="range"
              className="roi-slider"
              min={1}
              max={10}
              step={0.5}
              value={aiHours}
              onChange={(e) => setAiHours(Number(e.target.value))}
            />
          </div>

          <h2 className="roi-section-h2" style={{ marginTop: 12 }}>
            <IconCpu size={18} color="var(--gold)" />
            AI & RAG Architecture
          </h2>

          {/* Model Selection */}
          <div className="roi-field-group">
            <label className="roi-field-label">LLM Model Tier</label>
            <select
              className="roi-select"
              value={selectedModelKey}
              onChange={(e) => setSelectedModelKey(e.target.value)}
            >
              {Object.entries(MODEL_PRICING).map(([key, info]) => (
                <option key={key} value={key}>{info.name}</option>
              ))}
            </select>
          </div>

          {/* Chunking Architecture Strategy */}
          <div className="roi-field-group">
            <label className="roi-field-label">RAG Architecture Strategy</label>
            <div className="roi-toggle-group">
              <button
                className={`roi-toggle-btn${chunkStrategy === 'hybrid' ? ' active' : ''}`}
                onClick={() => setChunkStrategy('hybrid')}
              >
                ⚡ Hybrid (Metadata + 500t)
              </button>
              <button
                className={`roi-toggle-btn${chunkStrategy === 'legacy' ? ' active' : ''}`}
                onClick={() => setChunkStrategy('legacy')}
              >
                Standard (1500t)
              </button>
            </div>
          </div>
        </aside>

        {/* Analytics Display */}
        <main className="roi-analytics-stack">
          {/* Visual Financial Comparison */}
          <div className="roi-chart-card">
            <h2 className="roi-section-h2">
              <IconChartBar size={18} color="var(--gold)" />
              Monthly Financial & Efficiency Breakdown
            </h2>

            <div className="roi-bar-comparison">
              {/* Manual Effort Cost */}
              <div className="roi-bar-item">
                <div className="roi-bar-meta">
                  <span className="roi-bar-label">Manual Estimation Labor Cost</span>
                  <span className="roi-bar-val">{fmtCurrency(metrics.manualLaborCost)}</span>
                </div>
                <div className="roi-bar-track">
                  <div className="roi-bar-fill red" style={{ width: '100%' }} />
                </div>
              </div>

              {/* Calibre AI Labor Cost */}
              <div className="roi-bar-item">
                <div className="roi-bar-meta">
                  <span className="roi-bar-label">Calibre AI-Assisted Labor Cost</span>
                  <span className="roi-bar-val">{fmtCurrency(metrics.aiLaborCost)}</span>
                </div>
                <div className="roi-bar-track">
                  <div
                    className="roi-bar-fill green"
                    style={{ width: `${(metrics.aiLaborCost / metrics.manualLaborCost) * 100}%` }}
                  />
                </div>
              </div>

              {/* Monthly AI API Token Cost */}
              <div className="roi-bar-item">
                <div className="roi-bar-meta">
                  <span className="roi-bar-label">Monthly AI API Infrastructure Spend</span>
                  <span className="roi-bar-val">{fmtCurrency(metrics.totalAiCost)}</span>
                </div>
                <div className="roi-bar-track">
                  <div
                    className="roi-bar-fill gold"
                    style={{ width: `${Math.max(2, (metrics.totalAiCost / metrics.manualLaborCost) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="roi-chart-card">
            <h2 className="roi-section-h2">
              <IconCalculator size={18} color="var(--gold)" />
              Token Consumption & Cost Ledger
            </h2>

            <div className="roi-table-wrap">
              <table className="roi-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Volume / Month</th>
                    <th>Rate / Pricing</th>
                    <th>Monthly Cost</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Vector Document Embeddings</td>
                    <td>{fmtNumber(proposalsCount * 10)} documents</td>
                    <td>$0.02 / 1M tokens</td>
                    <td>{fmtCurrency(metrics.embedCost)}</td>
                    <td><span className="roi-badge-sm green">Optimized</span></td>
                  </tr>
                  <tr>
                    <td>Prompt Input Tokens (RAG Context)</td>
                    <td>{fmtNumber(metrics.totalQueries * (chunkStrategy === 'hybrid' ? 2000 : 15000))} tokens</td>
                    <td>${MODEL_PRICING[selectedModelKey].input.toFixed(2)} / 1M</td>
                    <td>{fmtCurrency(metrics.inputCost)}</td>
                    <td>
                      {chunkStrategy === 'hybrid' ? (
                        <span className="roi-badge-sm gold">Hybrid Capped (500t)</span>
                      ) : (
                        <span className="roi-badge-sm red">Uncapped (1500t)</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>LLM Output Response Tokens</td>
                    <td>{fmtNumber(metrics.totalQueries * (chunkStrategy === 'hybrid' ? 500 : 800))} tokens</td>
                    <td>${MODEL_PRICING[selectedModelKey].output.toFixed(2)} / 1M</td>
                    <td>{fmtCurrency(metrics.outputCost)}</td>
                    <td><span className="roi-badge-sm green">Grounded</span></td>
                  </tr>
                  <tr style={{ fontWeight: 600, background: 'var(--surface-2)' }}>
                    <td>Total Monthly AI Cost</td>
                    <td>{fmtNumber(metrics.totalQueries)} queries</td>
                    <td>Combined API</td>
                    <td>{fmtCurrency(metrics.totalAiCost)}</td>
                    <td><span className="roi-badge-sm gold">Net Active</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

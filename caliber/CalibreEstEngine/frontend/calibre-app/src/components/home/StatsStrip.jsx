export function StatsStrip() {
  return (
    <div className="stats-strip" role="status" aria-label="Platform statistics">
      <div className="stat-item">
        <span className="stat-icon">⚡</span>
        <span><strong>47</strong> Estimates Created</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-icon">📊</span>
        <span><strong>±8%</strong> Avg Accuracy</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-icon">✅</span>
        <span><strong>12</strong> Approved This Month</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-online">
        <div className="stat-online-dot" />
        EVA Online
      </div>
    </div>
  );
}

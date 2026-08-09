import { useAnimatedCounter } from '../../hooks/useAnimatedCounter';

export function KPIPill({ icon, value, label, color, prefix = '', suffix = '', delay = 0 }) {
  const count = useAnimatedCounter(value, 1200, delay);

  return (
    <div
      className="kpi-pill"
      style={{ borderTopColor: color }}
      aria-label={`${label}: ${prefix}${value}${suffix}`}
    >
      <div className="kpi-icon" style={{ color }}>
        {icon}
      </div>
      <div className="kpi-value" style={{ color }}>
        {prefix}{count}{suffix}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

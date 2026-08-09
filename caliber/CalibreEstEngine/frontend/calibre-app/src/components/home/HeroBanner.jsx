import { useRoleContext } from '../../contexts/RoleContext';
import { getTimeGreeting } from '../../constants/roles';
import { KPIPill } from './KPIPill';
import {
  IconActivity,
  IconTarget,
  IconClipboardCheck,
} from '@tabler/icons-react';
import '../../styles/home.css';

export function HeroBanner() {
  const { currentRole, currentRoleId } = useRoleContext();
  const { kpiData, heroTitle, heroMessage } = currentRole;
  const greeting = getTimeGreeting();

  return (
    <section className="hero-banner" aria-label="Welcome banner">
      <div className="hero-inner">
        {/* Left */}
        <div className="hero-left">
          <div className="hero-greeting">
            {greeting}, {currentRole.initials} · {heroTitle}
          </div>
          <h1 className="hero-title" style={{ color: currentRole.color }}>
            {currentRole.label}
          </h1>
          <p className="hero-subtitle">{heroMessage}</p>
        </div>

        {/* Right — KPI pills */}
        <div className="hero-right" role="group" aria-label="Key metrics">
          <KPIPill
            icon={<IconActivity size={16} strokeWidth={2} />}
            value={kpiData.activeEstimates}
            label="Active Estimates"
            color={currentRole.color}
            delay={100}
            key={`est-${currentRoleId}`}
          />
          <KPIPill
            icon={<IconTarget size={16} strokeWidth={2} />}
            value={kpiData.avgAccuracy}
            label="Avg. Accuracy"
            prefix="±"
            suffix="%"
            color="var(--amber)"
            delay={200}
            key={`acc-${currentRoleId}`}
          />
          <KPIPill
            icon={<IconClipboardCheck size={16} strokeWidth={2} />}
            value={kpiData.pendingReviews}
            label="Pending Reviews"
            color="var(--purple)"
            delay={300}
            key={`rev-${currentRoleId}`}
          />
        </div>
      </div>
    </section>
  );
}

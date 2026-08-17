import { useRoleContext } from '../../contexts/RoleContext';
import { getTimeGreeting } from '../../constants/roles';
import { dashboardFor } from '../../constants/dashboards';
import '../../styles/home.css';

// The KPI pills that used to live here read currentRole.kpiData — hardcoded
// per-role numbers (activeEstimates: 47, pendingReviews: 5) that no part of
// the system could actually measure. They're gone; real metrics now come from
// RoleDashboard, which only renders what the backend can genuinely report.
export function HeroBanner() {
  const { currentRole, user } = useRoleContext();
  const dashboard = dashboardFor(currentRole?.id);
  const greeting = getTimeGreeting();
  const firstName = user?.name?.split(' ')[0];

  return (
    <section className="hero-banner" aria-label="Welcome banner">
      <div className="hero-inner">
        <div className="hero-left">
          <div className="hero-greeting">
            {greeting}{firstName ? `, ${firstName}` : ''} · {currentRole?.label}
          </div>
          <h1 className="hero-title" style={{ color: currentRole?.color }}>
            {dashboard.title}
          </h1>
          <p className="hero-subtitle">{dashboard.tagline}</p>
        </div>
      </div>
    </section>
  );
}

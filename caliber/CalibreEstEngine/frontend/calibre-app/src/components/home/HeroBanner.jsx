import {
  IconCrown, IconShield, IconTool, IconCalculator,
} from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { getTimeGreeting } from '../../constants/roles';
import { dashboardFor } from '../../constants/dashboards';
import '../../styles/home.css';

// Same icon set ManageUsersPanel.jsx already keys by role — one mapping
// convention for "role -> icon" across the app.
const ROLE_ICONS = {
  admin: IconCrown, super: IconShield, sme: IconTool, estimator: IconCalculator,
};

// The KPI pills that used to live here read currentRole.kpiData — hardcoded
// per-role numbers (activeEstimates: 47, pendingReviews: 5) that no part of
// the system could actually measure. They're gone; real metrics now come from
// RoleDashboard, which only renders what the backend can genuinely report.
// hero-right isn't empty, though — a role-toned icon mark keeps the banner
// visually balanced instead of trailing off into blank space.
export function HeroBanner() {
  const { currentRole, user } = useRoleContext();
  const dashboard = dashboardFor(currentRole?.id);
  const greeting = getTimeGreeting();
  const firstName = user?.name?.split(' ')[0];
  const RoleIcon = ROLE_ICONS[currentRole?.id] || IconCalculator;

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
        <div className="hero-right">
          <div
            className="hero-role-mark"
            style={{
              color: currentRole?.color,
              borderColor: currentRole?.borderColor,
              background: currentRole?.glowColor,
              boxShadow: `0 0 32px ${currentRole?.glowColor}`,
            }}
            aria-hidden="true"
          >
            <RoleIcon size={30} strokeWidth={1.75} />
          </div>
        </div>
      </div>
    </section>
  );
}

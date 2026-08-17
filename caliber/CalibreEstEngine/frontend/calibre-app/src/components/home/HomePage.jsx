import { HeroBanner } from './HeroBanner';
import { WorkflowGrid } from './WorkflowGrid';
import { RoleDashboard } from './RoleDashboard';
import '../../styles/home.css';

// Each role gets its own dashboard (see constants/dashboards.js) rather than
// one shared page with buttons hidden. StatsStrip and ActivityFeed used to sit
// here; both were entirely hardcoded ("47 Estimates Created", five invented
// activity events) and were removed rather than re-skinned — Calibre has no
// estimate persistence, so those numbers could not be made real.
export function HomePage({ onLockedCardClick, onManageUsers }) {
  return (
    <main className="home-page" id="main-content" aria-label="Calibre home">
      <HeroBanner />
      <RoleDashboard onManageUsers={onManageUsers} />
      <WorkflowGrid onLockedClick={onLockedCardClick} />
    </main>
  );
}

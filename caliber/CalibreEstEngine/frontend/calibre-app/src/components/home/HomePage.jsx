import { useRoleContext } from '../../contexts/RoleContext';
import { HeroBanner } from './HeroBanner';
import { WorkflowGrid } from './WorkflowGrid';
import { ActivityFeed } from './ActivityFeed';
import { StatsStrip } from './StatsStrip';

export function HomePage({ onLockedCardClick }) {
  const { isTransitioning } = useRoleContext();

  return (
    <main
      className={`home-page${isTransitioning ? ' transitioning' : ''}`}
      id="main-content"
      aria-label="Calibre home"
    >
      <HeroBanner />
      <WorkflowGrid onLockedClick={onLockedCardClick} />
      <ActivityFeed />
      <StatsStrip />
    </main>
  );
}

import { useRoleContext } from '../../contexts/RoleContext';
import { hasCardAccess } from '../../constants/roles';
import { WORKFLOWS } from '../../constants/workflows';
import { WorkflowCard } from './WorkflowCard';

export function WorkflowGrid({ onLockedClick }) {
  const { currentRoleId, isTransitioning } = useRoleContext();

  return (
    <section className="workflow-section" aria-label="Workflow triggers">
      <div className="workflow-section-header">
        <div className="workflow-section-title">Workflow Triggers</div>
      </div>
      <div className={`workflow-grid${isTransitioning ? ' transitioning' : ''}`}>
        {WORKFLOWS.map((wf) => {
          const accessible = hasCardAccess(currentRoleId, wf.id);
          return (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              isLocked={!accessible}
              currentRoleId={currentRoleId}
              onLockedClick={() => onLockedClick(wf.title)}
            />
          );
        })}
      </div>
    </section>
  );
}

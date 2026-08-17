import { useRoleContext } from '../../contexts/RoleContext';
import { getCardMode } from '../../constants/roles';
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
          const mode = getCardMode(currentRoleId, wf.id);
          return (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              mode={mode}
              onLockedClick={() => onLockedClick(wf.title)}
            />
          );
        })}
      </div>
    </section>
  );
}

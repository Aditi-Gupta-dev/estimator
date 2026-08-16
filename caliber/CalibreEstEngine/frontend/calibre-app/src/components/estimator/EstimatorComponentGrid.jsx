import { Fragment, useMemo, useState } from 'react';
import { IconChevronDown, IconChevronRight, IconTable } from '@tabler/icons-react';
import { COMPLEXITY_LEVELS } from '../../constants/estimator-template';

export function EstimatorComponentGrid({
  componentRows, updateOverride, setIncludedForComponents, selectedCount, onNext,
}) {
  // Group rows by module, preserving template order.
  const { modules, rowsByModule } = useMemo(() => {
    const order = [];
    const grouped = {};
    componentRows.forEach((row) => {
      if (!grouped[row.module]) {
        grouped[row.module] = [];
        order.push(row.module);
      }
      grouped[row.module].push(row);
    });
    return { modules: order, rowsByModule: grouped };
  }, [componentRows]);

  const [expanded, setExpanded] = useState(() => new Set());

  const toggleModule = (module) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const allComponentNames = useMemo(() => componentRows.map((r) => r.component), [componentRows]);

  return (
    <div className="est-chart-card">
      <h2 className="est-section-h2">
        <IconTable size={18} color="var(--gold)" />
        Module Estimator
        <span className="est-selection-count">{selectedCount} of {componentRows.length} components selected</span>
      </h2>
      <div className="est-note">
        Only the components that actually apply to this engagement should be selected — unselected components
        don&apos;t contribute effort, cost, or FTE to the estimate. Click a module to expand it, tick the
        components you need, then adjust complexity/volume per row.
      </div>

      <div className="est-select-all-row">
        <button className="est-link-btn" onClick={() => setIncludedForComponents(allComponentNames, true)}>
          Select all
        </button>
        <button className="est-link-btn" onClick={() => setIncludedForComponents(allComponentNames, false)}>
          Clear all
        </button>
      </div>

      <div className="est-scroll-box">
        <table className="est-table">
          <thead>
            <tr>
              <th className="est-checkbox-col" />
              <th>Component</th>
              <th>Complexity</th>
              <th>Volume</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => {
              const rows = rowsByModule[module];
              const isOpen = expanded.has(module);
              const moduleSelected = rows.filter((r) => r.included).length;
              const moduleNames = rows.map((r) => r.component);
              return (
                <Fragment key={module}>
                  <tr
                    className="est-module-group-row est-module-toggle"
                    onClick={() => toggleModule(module)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleModule(module); } }}
                  >
                    <td className="est-checkbox-col">
                      <input
                        type="checkbox"
                        checked={moduleSelected === rows.length}
                        ref={(el) => { if (el) el.indeterminate = moduleSelected > 0 && moduleSelected < rows.length; }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setIncludedForComponents(moduleNames, e.target.checked)}
                        aria-label={`Select all components in ${module}`}
                      />
                    </td>
                    <td colSpan={4}>
                      <span className="est-module-toggle-inner">
                        {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        {module}
                        <span className="est-module-count">{moduleSelected}/{rows.length} selected</span>
                      </span>
                    </td>
                  </tr>
                  {isOpen && rows.map((row) => (
                    <tr key={row.component} className={row.included ? '' : 'est-row-excluded'}>
                      <td className="est-checkbox-col">
                        <input
                          type="checkbox"
                          checked={!!row.included}
                          onChange={(e) => updateOverride(row.component, 'included', e.target.checked)}
                          aria-label={`Include ${row.component}`}
                        />
                      </td>
                      <td>{row.component}</td>
                      <td>
                        <select
                          className="est-select est-select-sm"
                          value={row.complexity}
                          disabled={!row.included}
                          onChange={(e) => updateOverride(row.component, 'complexity', e.target.value)}
                        >
                          {COMPLEXITY_LEVELS.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="est-input est-input-sm"
                          value={row.volume}
                          step="1"
                          disabled={!row.included}
                          onChange={(e) => updateOverride(row.component, 'volume', Number(e.target.value))}
                        />
                      </td>
                      <td className="est-role-cell">{row.primary_role}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {onNext && <button className="est-run-btn" onClick={onNext}>Run Estimate →</button>}
    </div>
  );
}

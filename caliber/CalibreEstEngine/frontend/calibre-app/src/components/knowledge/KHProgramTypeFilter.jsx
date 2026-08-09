// Program type label prettifier
function prettifyPT(pt) {
  if (!pt || pt === 'general') return 'General';
  return pt.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function KHProgramTypeFilter({
  currentUnit,
  programTypeCounts,
  activeProgramType,
  onSetProgramType,
}) {
  const entries = Object.entries(programTypeCounts);
  if (!entries.length) return null;

  const buProgramTypes = currentUnit?.programTypes || [];

  // Sort: BU-defined order first, then others
  const sorted = [...entries].sort(([a], [b]) => {
    const ai = buProgramTypes.indexOf(a);
    const bi = buProgramTypes.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="kh-program-chips" id="kh-program-chips">
      <button
        className={`kh-program-chip${!activeProgramType ? ' active' : ''}`}
        onClick={() => onSetProgramType(null)}
      >
        All Programs
        <span className="kh-program-chip-count">{entries.reduce((s, [, c]) => s + c, 0)}</span>
      </button>
      {sorted.map(([pt, count]) => (
        <button
          key={pt}
          className={`kh-program-chip${activeProgramType === pt ? ' active' : ''}`}
          onClick={() => onSetProgramType(activeProgramType === pt ? null : pt)}
        >
          {prettifyPT(pt)}
          <span className="kh-program-chip-count">{count}</span>
        </button>
      ))}
    </div>
  );
}

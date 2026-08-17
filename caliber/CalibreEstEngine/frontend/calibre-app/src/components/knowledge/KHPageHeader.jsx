import { useRef, useEffect } from 'react';
import {
  IconSearch, IconX, IconUpload, IconLayoutGrid, IconList, IconFiles,
} from '@tabler/icons-react';
import { KHSearchOverlay } from './KHSearchOverlay';

export function KHPageHeader({
  searchQuery, onSearchChange, isSearchOpen, onSearchFocus, onCloseSearch,
  // Subdivision props
  visibleSubdivisions, activeSubdivision, onSelectSubdivision, subdivisionCounts,
  viewMode, onToggleView,
  canUpload, onOpenUpload,
  canManageDocuments, onOpenGovernance,
  activeFilters, onClearAll,
  onItemSelect, selectedUnitId,
  openEVA,
}) {
  const searchRef = useRef(null);

  // Close overlay on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        onCloseSearch?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCloseSearch]);

  return (
    <header className="kh-header">
      {/* Top row: breadcrumb + badge */}
      <div className="kh-header-top">
        <nav className="kh-breadcrumb">
          <span className="kh-breadcrumb-link" onClick={() => window.history.back()}>Home</span>
          <span className="kh-breadcrumb-sep">›</span>
          <span className="kh-breadcrumb-current">What / How to Estimate</span>
        </nav>
        <span className="kh-section-badge">TRIGGER 01</span>
      </div>

      {/* Bottom row: search + filters + actions */}
      <div className="kh-header-bottom">
        {/* Search */}
        <div className="kh-search-wrap" ref={searchRef}>
          <div className="kh-search">
            <IconSearch size={14} />
            <input
              id="kh-search-input"
              className="kh-search-input"
              placeholder="Search guidelines, templates, data..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={onSearchFocus}
              autoComplete="off"
            />
            {searchQuery && (
              <button className="kh-search-clear" onClick={() => onSearchChange('')} aria-label="Clear search">
                <IconX size={10} />
              </button>
            )}
          </div>
          {isSearchOpen && (
            <KHSearchOverlay
              query={searchQuery}
              onSelectItem={onItemSelect}
              onClose={onCloseSearch}
              openEVA={openEVA}
            />
          )}
        </div>

        {/* Subdivision filter tabs */}
        {visibleSubdivisions && (
          <div className="kh-type-tabs">
            <button
              id="kh-tab-all"
              className={`kh-type-tab${!activeSubdivision ? ' active' : ''}`}
              style={!activeSubdivision ? { color: 'var(--gold)', borderColor: 'var(--gold-border)' } : {}}
              onClick={() => onSelectSubdivision(null)}
            >
              All
              <span className="kh-type-tab-count">
                {Object.values(subdivisionCounts || {}).reduce((a, b) => a + b, 0)}
              </span>
            </button>
            {visibleSubdivisions.map((sub) => {
              const count = subdivisionCounts?.[sub.id] || 0;
              if (count === 0) return null;
              const isActive = activeSubdivision === sub.id;
              return (
                <button
                  key={sub.id}
                  id={`kh-tab-${sub.id}`}
                  className={`kh-type-tab${isActive ? ' active' : ''}`}
                  style={isActive ? { color: sub.color, borderColor: sub.border } : {}}
                  onClick={() => onSelectSubdivision(isActive ? null : sub.id)}
                >
                  {sub.label}
                  <span className="kh-type-tab-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* View toggle + Upload */}
        <div className="kh-header-actions">
          <button
            id="kh-view-grid"
            className={`kh-view-btn${viewMode === 'grid' ? ' active' : ''}`}
            onClick={() => viewMode !== 'grid' && onToggleView()}
            title="Grid view"
          >
            <IconLayoutGrid size={15} />
          </button>
          <button
            id="kh-view-list"
            className={`kh-view-btn${viewMode === 'list' ? ' active' : ''}`}
            onClick={() => viewMode !== 'list' && onToggleView()}
            title="List view"
          >
            <IconList size={15} />
          </button>

          {canManageDocuments && (
            <button id="kh-governance-btn" className="kh-upload-btn" onClick={onOpenGovernance}>
              <IconFiles size={14} />
              Manage Documents
            </button>
          )}

          {canUpload && (
            <button id="kh-upload-btn" className="kh-upload-btn" onClick={onOpenUpload}>
              <IconUpload size={14} />
              Upload
            </button>
          )}
        </div>
      </div>

      {/* Active filters pill bar */}
      {activeFilters.length > 0 && (
        <div className="kh-filter-pills">
          {activeFilters.map((f) => (
            <span key={f.id} className="kh-filter-pill">
              {f.label}
              <span className="kh-filter-pill-x" onClick={f.onRemove}>✕</span>
            </span>
          ))}
          <button className="kh-filter-clear-all" onClick={onClearAll}>Clear all</button>
        </div>
      )}
    </header>
  );
}

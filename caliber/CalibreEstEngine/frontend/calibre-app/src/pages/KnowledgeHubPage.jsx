import '../styles/knowledge-hub.css';
import { useKnowledgeHub } from '../hooks/useKnowledgeHub';
import { useEVA } from '../hooks/useEVA';
import { KHPageHeader } from '../components/knowledge/KHPageHeader';
import { KHSidebar } from '../components/knowledge/KHSidebar';
import { KHAllUnitsView } from '../components/knowledge/KHAllUnitsView';
import { KHBUHero } from '../components/knowledge/KHBUHero';
import { KHSubdivisionNav } from '../components/knowledge/KHSubdivisionNav';
import { KHProgramTypeFilter } from '../components/knowledge/KHProgramTypeFilter';
import { KHContentGrid } from '../components/knowledge/KHContentGrid';
import { KHRightPanel } from '../components/knowledge/KHRightPanel';
import { KHDetailModal } from '../components/knowledge/KHDetailModal';
import { KHUploadModal } from '../components/knowledge/KHUploadModal';
import { DocumentGovernancePanel } from '../components/knowledge/DocumentGovernancePanel';
import { KHDownloadToast } from '../components/knowledge/KHDownloadToast';

export default function KnowledgeHubPage() {
  const hub = useKnowledgeHub();
  const { openEVA } = useEVA();

  // Open EVA with a context message
  const askEVA = (contextOrItem) => {
    const msg = typeof contextOrItem === 'string'
      ? contextOrItem
      : contextOrItem
        ? `Tell me about "${contextOrItem.title}" — ${contextOrItem.description?.slice(0, 120)}…`
        : 'Help me find estimation content in the Knowledge Hub.';
    openEVA?.();
    // Slight delay so EVA panel opens first
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('eva:inject', { detail: { message: msg } }));
    }, 300);
  };

  return (
    <div className="kh-page" id="kh-page">
      {/* Page header */}
      <KHPageHeader
        searchQuery={hub.searchQuery}
        onSearchChange={hub.handleSearchChange}
        isSearchOpen={hub.isSearchOpen}
        onSearchFocus={hub.handleSearchFocus}
        onCloseSearch={hub.closeSearch}
        visibleSubdivisions={hub.visibleSubdivisions}
        activeSubdivision={hub.activeSubdivision}
        onSelectSubdivision={hub.selectSubdivision}
        subdivisionCounts={hub.subdivisionCounts}
        viewMode={hub.viewMode}
        onToggleView={hub.toggleViewMode}
        canUpload={hub.canUpload}
        onOpenUpload={hub.openUpload}
        canManageDocuments={hub.canUpload}
        onOpenGovernance={hub.openGovernance}
        activeFilters={hub.activeFilters}
        onClearAll={hub.clearAllFilters}
        onItemSelect={hub.selectItem}
        selectedUnitId={hub.selectedUnitId}
        openEVA={askEVA}
      />

      {/* 3-panel body */}
      <div className="kh-body">
        {/* Left sidebar */}
        <KHSidebar
          selectedUnitId={hub.selectedUnitId}
          onSelectUnit={hub.selectUnit}
          allUnitStats={hub.allUnitStats}
          activeSubdivision={hub.activeSubdivision}
          onSelectSubdivision={hub.selectSubdivision}
          visibleSubdivisions={hub.visibleSubdivisions}
          subdivisionCounts={hub.subdivisionCounts}
        />

        {/* Center content */}
        <main className="kh-center" id="kh-center">
          {hub.selectedUnitId === 'all' ? (
            /* All-units overview */
            <KHAllUnitsView
              allUnitStats={hub.allUnitStats}
              onSelectUnit={hub.selectUnit}
            />
          ) : (
            /* Single BU view */
            <>
              <KHBUHero
                unit={hub.currentUnit}
                onAskEVA={askEVA}
                dynamicStats={hub.allUnitStats[hub.selectedUnitId]}
              />
              <KHSubdivisionNav
                visibleSubdivisions={hub.visibleSubdivisions}
                activeSubdivision={hub.activeSubdivision}
                onSelectSubdivision={hub.selectSubdivision}
                subdivisionCounts={hub.subdivisionCounts}
              />
              {hub.activeSubdivision && (
                <KHProgramTypeFilter
                  currentUnit={hub.currentUnit}
                  programTypeCounts={hub.programTypeCounts}
                  activeProgramType={hub.activeProgramType}
                  onSetProgramType={hub.setActiveProgramType}
                />
              )}
              <div className="kh-content-area">
                <KHContentGrid
                  items={hub.filteredContent}
                  viewMode={hub.viewMode}
                  selectedItem={hub.selectedItem}
                  onSelect={hub.selectItem}
                  onPreview={hub.openModal}
                  onDownload={hub.downloadItem}
                  onAskEVA={askEVA}
                  downloadCounts={hub.downloadCounts}
                  searchQuery={hub.searchQuery}
                  onOpenUpload={hub.canUpload ? hub.openUpload : null}
                  canUpload={hub.canUpload}
                />
              </div>
            </>
          )}
        </main>

        {/* Right panel */}
        <KHRightPanel
          isOpen={hub.isRightPanelOpen}
          onClose={hub.toggleRightPanel}
          selectedItem={hub.selectedItem}
          selectedUnit={hub.currentUnit}
          onDownload={hub.downloadItem}
          onPreview={hub.openModal}
          onOpenModal={hub.openModal}
          onAskEVA={askEVA}
          openEVA={askEVA}
        />
      </div>

      {/* Overlays */}
      {hub.modalItem && (
        <KHDetailModal
          item={hub.modalItem}
          onClose={hub.closeModal}
          onDownload={hub.downloadItem}
          onAskEVA={askEVA}
          onSelectRelated={hub.selectItem}
        />
      )}

      {hub.isUploadOpen && (
        <KHUploadModal
          onClose={hub.closeUpload}
          onUploadComplete={hub.onUploadComplete}
        />
      )}

      {hub.isGovernanceOpen && (
        <DocumentGovernancePanel onClose={hub.closeGovernance} />
      )}

      <KHDownloadToast
        download={hub.activeDownload}
        onDismiss={hub.dismissDownload}
      />
    </div>
  );
}

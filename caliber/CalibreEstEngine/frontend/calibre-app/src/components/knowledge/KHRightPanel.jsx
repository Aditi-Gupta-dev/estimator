import { IconX, IconSparkles } from '@tabler/icons-react';
import { KHUnitSummary } from './KHUnitSummary';
import { KHContentPreview } from './KHContentPreview';

export function KHRightPanel({
  isOpen, onClose,
  selectedItem, selectedUnit,
  onDownload, onPreview, onOpenModal, onAskEVA,
  openEVA,
}) {
  return (
    <aside className={`kh-right${isOpen ? '' : ' collapsed'}`} id="kh-right-panel">
      <div className="kh-right-header">
        <span className="kh-right-title">
          {selectedItem ? 'Content Preview' : 'Unit Overview'}
        </span>
        <button className="kh-right-close" onClick={onClose} aria-label="Close panel">
          <IconX size={14} />
        </button>
      </div>

      {selectedItem ? (
        <KHContentPreview
          item={selectedItem}
          onDownload={onDownload}
          onPreview={onPreview}
          onOpenModal={onOpenModal}
          onAskEVA={onAskEVA}
        />
      ) : (
        <KHUnitSummary
          unit={selectedUnit}
          openEVA={openEVA}
        />
      )}
    </aside>
  );
}

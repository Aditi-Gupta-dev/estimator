import { KHContentCard } from './KHContentCard';
import { KHContentListItem } from './KHContentListItem';
import { KHEmptyState } from './KHEmptyState';
import { IconSearch } from '@tabler/icons-react';

export function KHContentGrid({
  items, viewMode, selectedItem,
  onSelect, onPreview, onDownload, onAskEVA,
  downloadCounts, searchQuery, onOpenUpload, canUpload,
}) {
  if (!items.length) {
    return (
      <KHEmptyState
        query={searchQuery}
        onAskEVA={() => onAskEVA(null)}
        onUpload={canUpload ? onOpenUpload : null}
      />
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="kh-grid" id="kh-content-grid">
        {items.map((item, i) => (
          <KHContentCard
            key={item.id}
            item={item}
            isSelected={selectedItem?.id === item.id}
            onSelect={onSelect}
            onPreview={onPreview}
            onDownload={onDownload}
            onAskEVA={onAskEVA}
            downloadCount={downloadCounts[item.id] || 0}
            style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="kh-list" id="kh-content-list">
      {items.map((item, i) => (
        <KHContentListItem
          key={item.id}
          item={item}
          isSelected={selectedItem?.id === item.id}
          onSelect={onSelect}
          onPreview={onPreview}
          onDownload={onDownload}
          onAskEVA={onAskEVA}
          downloadCount={downloadCounts[item.id] || 0}
          style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
        />
      ))}
    </div>
  );
}

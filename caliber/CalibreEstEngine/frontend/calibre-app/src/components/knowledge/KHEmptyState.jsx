import { IconSearch, IconSparkles, IconUpload } from '@tabler/icons-react';

export function KHEmptyState({ query, onAskEVA, onUpload }) {
  return (
    <div className="kh-empty" id="kh-empty-state">
      <div className="kh-empty-icon">
        <IconSearch size={28} />
      </div>
      <div className="kh-empty-title">
        {query ? `No results for "${query}"` : 'No content here yet'}
      </div>
      <div className="kh-empty-sub">
        {query
          ? 'Try a different search term or browse by business unit. EVA can help you find what you need.'
          : 'No content matches the current filters. Try selecting a different unit or content type.'}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="kh-empty-eva-btn" onClick={onAskEVA}>
          <IconSparkles size={15} />
          {query ? `Ask EVA: "${query}"` : 'Ask EVA for help'}
        </button>
        {onUpload && (
          <button
            className="kh-empty-eva-btn"
            style={{ borderColor: 'var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)' }}
            onClick={onUpload}
          >
            <IconUpload size={15} />
            Upload content
          </button>
        )}
      </div>
    </div>
  );
}

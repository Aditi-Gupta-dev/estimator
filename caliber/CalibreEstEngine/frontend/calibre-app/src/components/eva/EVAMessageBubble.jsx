import { useNavigate } from 'react-router-dom';
import { EVAAvatar } from './EVAAvatar';
import { formatEVAText } from '../../hooks/useEVA';
import { CLASSIFIER_TOKEN_CLASS } from '../../constants/eva-system-prompt';

export function EVAMessageBubble({ message, roleInitials, roleColor }) {
  const { from, text, classifier, evaFn, citations, isRestricted, cacheHit, agentTrail } = message;
  const isEVA = from === 'eva';
  const navigate = useNavigate();
  const tokenClass = evaFn?.id ? CLASSIFIER_TOKEN_CLASS[evaFn.id] : null;

  const goToCitation = (c) => {
    if (!c.document_path) return;
    navigate(`/estimate/guide?item=${encodeURIComponent(c.document_path)}`);
  };

  return (
    <div className={`msg-row ${from}`}>
      {/* Avatar */}
      <div className={`msg-avatar-sm${isEVA ? '' : ' user-av'}`}
        style={!isEVA ? { borderColor: `${roleColor}60`, color: roleColor, background: `${roleColor}18` } : {}}
      >
        {isEVA ? (
          <EVAAvatar size="sm" animate={false} />
        ) : (
          roleInitials
        )}
      </div>

      {/* Bubble */}
      <div className={`msg-bubble${isRestricted ? ' restricted' : ''}`}>
        <div
          dangerouslySetInnerHTML={{ __html: formatEVAText(text) }}
          style={{ whiteSpace: 'pre-wrap' }}
        />

        {/* Citations */}
        {isEVA && citations?.length > 0 && (
          <div className="citation-row">
            {citations.map((c) => (
              <button
                key={c.tag}
                type="button"
                className={`citation-chip${c.document_path ? '' : ' citation-chip-disabled'}`}
                onClick={() => goToCitation(c)}
                disabled={!c.document_path}
                title={c.document_path ? `Open ${c.document_title}` : c.document_title}
              >
                <span className="citation-tag">{c.tag}</span>
                {c.document_title}
              </button>
            ))}
          </div>
        )}

        {/* Agent trail */}
        {isEVA && agentTrail?.length > 0 && (
          <div className="agent-trail-row">
            {agentTrail.map((s, i) => (
              <span key={i} className="agent-trail-chip" title={s.detail || undefined}>
                {s.label}
                {i < agentTrail.length - 1 && <span className="agent-trail-arrow">→</span>}
              </span>
            ))}
          </div>
        )}

        {/* Cache-hit badge */}
        {isEVA && cacheHit && <span className="cache-hit-badge">Cached</span>}

        {/* Classifier tag */}
        {classifier && tokenClass && (
          <div className={`classifier-tag ${tokenClass}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <path d="M9 9h6M9 12h6M9 15h4"/>
            </svg>
            Classifier → {classifier.label}
          </div>
        )}
      </div>
    </div>
  );
}

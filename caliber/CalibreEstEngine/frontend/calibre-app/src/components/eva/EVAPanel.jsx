import { useRef, useEffect } from 'react';
import { IconRefresh, IconX, IconMessage, IconMicrophone } from '@tabler/icons-react';
import { EVAAvatar } from './EVAAvatar';
import { EVAMessageBubble } from './EVAMessageBubble';
import { EVASuggestions } from './EVASuggestions';
import { EVAInput } from './EVAInput';
import { EVAVoiceMode } from './EVAVoiceMode';
import { useRoleContext } from '../../contexts/RoleContext';

export function EVAPanel({ evaState }) {
  const {
    isOpen, closeEVA, clearChat,
    messages, sendMessage, isTyping, isOffline,
    mode, setMode, suggestions,
    hasEstimatorContext,
  } = evaState;
  const { currentRole } = useRoleContext();
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [messages, isTyping, isOpen]);

  return (
    <div
      className={`eva-panel${isOpen ? ' open' : ''}`}
      role="dialog"
      aria-label="EVA — Estimation Virtual Assistant"
      aria-modal="true"
    >
      {/* ── Header ── */}
      <div className="eva-header">
        <EVAAvatar size="md" animate thinking={isTyping} />
        <div className="eva-header-info">
          <div className="eva-header-name">EVA</div>
          <div className={`eva-header-status${isOffline ? ' offline' : ''}`}>
            <div className={`eva-status-dot${isOffline ? ' offline' : ''}`} />
            {isTyping ? 'Thinking…' : isOffline ? 'Offline — service unreachable' : 'Online — ready to assist'}
          </div>
          {hasEstimatorContext && (
            <div className="eva-context-badge" title="EVA can see the estimate you're working on">
              <span className="eva-context-dot" />
              Estimator context active
            </div>
          )}
        </div>
        <div className="eva-header-actions">
          <button
            className="eva-icon-btn"
            onClick={clearChat}
            title="Clear chat"
            aria-label="Clear chat"
          >
            <IconRefresh size={15} strokeWidth={2} />
          </button>
          <button
            className="eva-icon-btn"
            onClick={closeEVA}
            title="Close EVA"
            aria-label="Close EVA panel"
          >
            <IconX size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── Mode bar ── */}
      <div className="eva-mode-bar">
        <button
          className={`eva-mode-tab${mode === 'text' ? ' active' : ''}`}
          onClick={() => setMode('text')}
          aria-label="Text chat mode"
          aria-pressed={mode === 'text'}
        >
          <IconMessage size={15} strokeWidth={2} />
          Chat
        </button>
        <button
          className={`eva-mode-tab${mode === 'voice' ? ' active' : ''}`}
          onClick={() => setMode('voice')}
          aria-label="Voice mode"
          aria-pressed={mode === 'voice'}
        >
          <IconMicrophone size={15} strokeWidth={2} />
          Voice
        </button>
      </div>

      {/* ── Content area ── */}
      {mode === 'text' ? (
        <>
          {/* Messages */}
          <div className="eva-messages" id="eva-messages" aria-live="polite">
            {messages.map((msg) => (
              <EVAMessageBubble
                key={msg.id}
                message={msg}
                roleInitials={currentRole.initials}
                roleColor={currentRole.color}
              />
            ))}
            {isTyping && (
              <div className="msg-row eva">
                <div className="msg-avatar-sm">
                  <EVAAvatar size="sm" animate={false} thinking />
                </div>
                <div className="msg-bubble">
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <EVASuggestions suggestions={suggestions} onSend={sendMessage} isTyping={isTyping} />

          {/* Input */}
          <EVAInput onSend={sendMessage} isTyping={isTyping} />
        </>
      ) : (
        <EVAVoiceMode onResult={sendMessage} onClose={() => setMode('text')} />
      )}
    </div>
  );
}

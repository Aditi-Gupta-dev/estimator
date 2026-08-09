import { useState, useRef } from 'react';
import { IconSend } from '@tabler/icons-react';

export function EVAInput({ onSend, isTyping }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const handleSend = () => {
    const text = value.trim();
    if (!text || isTyping) return;
    onSend(text);
    setValue('');
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="eva-input-row">
      <input
        ref={inputRef}
        className="eva-input"
        type="text"
        placeholder="Ask EVA anything about estimation…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        disabled={isTyping}
        aria-label="Message EVA"
        autoComplete="off"
      />
      <button
        className="eva-send-btn"
        onClick={handleSend}
        disabled={!value.trim() || isTyping}
        aria-label="Send message"
      >
        <IconSend size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

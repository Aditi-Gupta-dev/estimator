export function EVASuggestions({ suggestions, onSend, isTyping }) {
  if (!suggestions?.length) return null;

  return (
    <div className="eva-suggestions">
      <div className="suggestions-label">Try asking</div>
      <div className="suggestions-row">
        {suggestions.map((text) => (
          <button
            key={text}
            className="suggestion-chip"
            onClick={() => !isTyping && onSend(text)}
            disabled={isTyping}
            aria-label={`Ask EVA: ${text}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

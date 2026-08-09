import { useState, useCallback } from 'react';
import { IconMicrophone, IconPlayerStop, IconPlayerPlay } from '@tabler/icons-react';
import { useVoice } from '../../hooks/useVoice';
import { EVAAvatar } from './EVAAvatar';

const WAVEFORM_BARS = [8, 16, 24, 18, 28, 14, 22, 12, 20, 10];

export function EVAVoiceMode({ onResult, onClose }) {
  const [lastTranscript, setLastTranscript] = useState('');

  const handleResult = useCallback((text) => {
    setLastTranscript(text);
    onResult(text);
    onClose(); // Switch back to text after voice input
  }, [onResult, onClose]);

  const { isSupported, isListening, transcript, isSpeaking, startListening, stopListening } = useVoice({
    onResult: handleResult,
  });

  const handleOrbClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!isSupported) {
    return (
      <div className="eva-voice-panel" style={{ gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <EVAAvatar size="lg" animate />
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 16, lineHeight: 1.6 }}>
            Voice mode is not supported in this browser.<br />
            Please use Chrome or Edge for voice interaction.
          </p>
        </div>
        <button
          onClick={onClose}
          className="voice-ctrl-btn"
          aria-label="Switch to text chat"
        >
          Switch to Text Chat
        </button>
      </div>
    );
  }

  return (
    <div className="eva-voice-panel">
      {/* Voice orb */}
      <button
        className={`voice-orb${isListening ? ' listening' : ''}${isSpeaking ? ' speaking' : ''}`}
        onClick={handleOrbClick}
        aria-label={isListening ? 'Stop listening' : 'Start listening'}
        title={isListening ? 'Tap to stop' : 'Tap to speak'}
      >
        <IconMicrophone size={38} strokeWidth={1.8} color="white" />
      </button>

      {/* Waveform */}
      <div className="voice-waveform" aria-hidden="true">
        {WAVEFORM_BARS.map((h, i) => (
          <div
            key={i}
            className={`waveform-bar${isListening || isSpeaking ? ' active' : ''}`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>

      {/* Status */}
      <div className="voice-status">
        {isSpeaking
          ? '🔊 EVA is speaking…'
          : isListening
          ? '🎤 Listening… speak now'
          : 'Tap the orb to speak to EVA'}
      </div>

      {/* Transcript */}
      {(transcript || lastTranscript) && (
        <div className="voice-transcript">
          "{transcript || lastTranscript}"
        </div>
      )}

      {/* Controls */}
      <div className="voice-controls">
        {isListening ? (
          <button
            className="voice-ctrl-btn"
            onClick={stopListening}
            aria-label="Stop recording"
          >
            <IconPlayerStop size={14} strokeWidth={2} />
            Stop
          </button>
        ) : (
          <button
            className="voice-ctrl-btn"
            onClick={startListening}
            aria-label="Start recording"
          >
            <IconPlayerPlay size={14} strokeWidth={2} />
            Start Speaking
          </button>
        )}
        <button
          className="voice-ctrl-btn"
          onClick={onClose}
          aria-label="Switch to text chat"
        >
          Text Mode
        </button>
      </div>
    </div>
  );
}

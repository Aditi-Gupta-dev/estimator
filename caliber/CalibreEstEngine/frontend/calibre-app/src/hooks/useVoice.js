import { useState, useEffect, useRef, useCallback } from 'react';

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function useVoice({ onResult, onError }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported] = useState(() => !!SpeechRecognition);
  const recognitionRef = useRef(null);

  // ── Speech Recognition ──────────────────────────────────────────────────
  useEffect(() => {
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);
      if (final) {
        setIsListening(false);
        onResult?.(final.trim());
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setTranscript('');
      onError?.(event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
    };
  }, [onResult, onError]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    setTranscript('');
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      setIsListening(false);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, []);

  // ── Speech Synthesis (EVA speaks) ─────────────────────────────────────
  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Strip markdown for TTS
    const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/<br\/>/g, ' ').replace(/<[^>]+>/g, '');
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.volume = 1;
    // Prefer a female voice
    const voices = window.speechSynthesis.getVoices();
    const female = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.toLowerCase().includes('female') ||
          v.name.toLowerCase().includes('samantha') ||
          v.name.toLowerCase().includes('zira') ||
          v.name.toLowerCase().includes('aria') ||
          v.name.toLowerCase().includes('google us english'))
    );
    if (female) utterance.voice = female;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    isSpeaking,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}

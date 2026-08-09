/**
 * useEVA — EVA chat state hook
 *
 * Wires the EVA_SYSTEM_PROMPT (v2.0) into the UI layer via the real
 * backend at POST /api/eva (proxied by upload-server to eva_service — see
 * EVA_RAG_IMPLEMENTATION_PLAN.md). The server runs planning, retrieval,
 * role-gating and generation internally as one round-trip; buildFallbackPlan
 * here is only a last-resort client-side badge renderer used if the fetch
 * itself fails, not the source of truth for retrieval.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRoleContext } from '../contexts/RoleContext';
import { SUGGESTIONS, RESTRICTED_REPLY } from '../constants/eva-responses';
import {
  EVA_SYSTEM_PROMPT,
  EVA_PROMPT_VERSION,
  classifyEVAFunction,
} from '../constants/eva-system-prompt';
import { buildFallbackPlan } from '../constants/eva-retrieval-planner';

const EVA_CHAT_URL = 'http://localhost:3001/api/eva';

// ── Memory identity persistence (localStorage) ────────────────────────────────
// clientId: per-browser identity for LONG-TERM memory (survives forever,
// across every session/reload — this app has no login/account system, so
// "this browser" is the closest thing to a durable user identity).
// sessionId: SHORT-TERM memory continuity — reused across reloads so the
// last-20-message window (see backend retrieval/short_term_memory.py) isn't
// silently reset every time the page refreshes; only rotated when the user
// explicitly clears the chat (see clearChat below).
const CLIENT_ID_KEY  = 'eva_client_id';
const SESSION_ID_KEY = 'eva_session_id';

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function getOrCreateStoredId(key) {
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = newId();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall back to an
    // in-memory-only id; memory just won't survive a reload this session.
    return newId();
  }
}

function rotateStoredSessionId() {
  const id = newId();
  try { window.localStorage.setItem(SESSION_ID_KEY, id); } catch { /* ignore */ }
  return id;
}

// ── Rolling summary for the planner's turn_history_summary (<=80 tokens) ─────
// Last-resort client-side fallback only — the backend now builds this from
// real persisted ChatMessage history (see retrieval/short_term_memory.py)
// whenever a session has any, which is the actual source of truth.
function buildRollingSummary(messages) {
  return messages
    .slice(-4)
    .map((m) => `${m.from === 'user' ? 'User' : 'EVA'}: ${m.text}`)
    .join(' | ')
    .slice(0, 400);
}

// ── Format **bold** markdown in EVA text ─────────────────────────────────────
export function formatEVAText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

// ── EVA hook ──────────────────────────────────────────────────────────────────
export function useEVA() {
  const { currentRole, currentRoleId, activeUnitId } = useRoleContext();
  const [isOpen, setIsOpen]     = useState(false);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [mode, setMode]         = useState('text'); // 'text' | 'voice'
  const prevRoleIdRef           = useRef(null);
  const clientIdRef             = useRef(getOrCreateStoredId(CLIENT_ID_KEY));
  const sessionIdRef            = useRef(getOrCreateStoredId(SESSION_ID_KEY));

  // Reset greeting only when role actually changes
  useEffect(() => {
    if (prevRoleIdRef.current === currentRoleId) return;
    prevRoleIdRef.current = currentRoleId;
    setMessages([{
      id:         Date.now(),
      from:       'eva',
      text:       currentRole.evaGreeting,
      classifier: null,
      evaFn:      null,
    }]);
  }, [currentRoleId, currentRole.evaGreeting]);

  const toggleEVA = useCallback(() => setIsOpen((prev) => !prev), []);
  const openEVA   = useCallback(() => setIsOpen(true), []);
  const closeEVA  = useCallback(() => setIsOpen(false), []);

  const clearChat = useCallback(() => {
    // Explicit clear is the one point where short-term memory should
    // actually reset — start a fresh session id so the next turn doesn't
    // pull in the just-cleared conversation as prior context.
    sessionIdRef.current = rotateStoredSessionId();
    setMessages([{
      id:         Date.now(),
      from:       'eva',
      text:       currentRole.evaGreeting,
      classifier: null,
      evaFn:      null,
    }]);
  }, [currentRole]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    // ── Append user message (instant client-side badge, server is authoritative) ──
    const evaFn = classifyEVAFunction(text);
    const userMsg = { id: Date.now(), from: 'user', text, classifier: null, evaFn: null };
    const rollingSummary = buildRollingSummary(messages);
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const response = await fetch(EVA_CHAT_URL, {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:        text,
          callerRole:     currentRoleId,
          unitId:         activeUnitId,
          sessionId:      sessionIdRef.current,
          clientId:       clientIdRef.current,
          rollingSummary,
        }),
      });

      if (!response.ok) throw new Error(`EVA request failed (HTTP ${response.status})`);
      const data = await response.json();

      setMessages((prev) => [...prev, {
        id:           Date.now() + 1,
        from:         'eva',
        text:         data.answer,
        classifier:   data.evaFn ? { label: data.evaFn.label, color: data.evaFn.color } : null,
        evaFn:        data.evaFn || evaFn,
        plan:         data.plan,
        isRestricted: data.isRestricted || false,
        citations:    data.citations || [],
        cacheHit:     data.cacheHit || false,
        agentTrail:   data.agentTrail || [],
        mlCalibration: data.mlCalibration || null,
      }]);
    } catch (err) {
      // Deliberately does NOT fake a success reply (unlike useUpload.js's
      // fallback) — a silent fake answer here would be actively misleading
      // in a grounded-reasoning assistant.
      console.error('EVA request failed:', err.message);
      setMessages((prev) => [...prev, {
        id:      Date.now() + 1,
        from:    'eva',
        text:    'EVA is offline — the assistant service could not be reached. Try again shortly, or contact Admin / COE if this persists.',
        classifier: null,
        evaFn,
        plan:    buildFallbackPlan({ userTurn: text, callerRole: currentRoleId, unitId: activeUnitId }),
        isError: true,
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [currentRoleId, activeUnitId, messages]);

  const sendRestrictedMessage = useCallback((cardTitle) => {
    openEVA();
    setTimeout(() => {
      setMessages((prev) => [...prev,
        { id: Date.now(),     from: 'user', text: `I want to access: ${cardTitle}`, classifier: null },
      ]);
      setIsTyping(true);
      setTimeout(() => {
        setMessages((prev) => [...prev, {
          id:         Date.now() + 1,
          from:       'eva',
          text:       RESTRICTED_REPLY(currentRole.label, cardTitle),
          classifier: null,
          evaFn:      null,
        }]);
        setIsTyping(false);
      }, 800);
    }, 300);
  }, [currentRole, openEVA]);

  const suggestions = SUGGESTIONS[currentRoleId] || SUGGESTIONS.estimator;

  return {
    isOpen, toggleEVA, openEVA, closeEVA,
    messages, sendMessage, sendRestrictedMessage, clearChat,
    isTyping, mode, setMode, suggestions,
    // Expose for debugging / LLM integration
    systemPrompt:        EVA_SYSTEM_PROMPT,
    systemPromptVersion: EVA_PROMPT_VERSION,
  };
}

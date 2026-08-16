import {
  createContext, useContext, useRef, useState, useCallback,
} from 'react';

// Bridges the estimator page's live state to EVA, which is mounted globally
// in App.jsx and therefore sits OUTSIDE the estimator page's component tree.
//
// The snapshot lives in a ref, not state, on purpose: the estimator page
// republishes whenever its result changes, and re-rendering the whole EVA
// panel each time would be pure waste. EVA reads the latest snapshot only
// at send time via getEstimatorContext(). `hasContext` is the one piece of
// real state — it flips only when an estimate appears/disappears, and just
// drives the "estimator context active" indicator.

const EstimatorContext = createContext(null);

export function EstimatorContextProvider({ children }) {
  const snapshotRef = useRef(null);
  const [hasContext, setHasContext] = useState(false);

  const publishEstimatorContext = useCallback((snapshot) => {
    snapshotRef.current = snapshot;
    setHasContext(!!snapshot);
  }, []);

  const clearEstimatorContext = useCallback(() => {
    snapshotRef.current = null;
    setHasContext(false);
  }, []);

  const getEstimatorContext = useCallback(() => snapshotRef.current, []);

  return (
    <EstimatorContext.Provider value={{
      hasContext, publishEstimatorContext, clearEstimatorContext, getEstimatorContext,
    }}
    >
      {children}
    </EstimatorContext.Provider>
  );
}

export function useEstimatorContext() {
  const ctx = useContext(EstimatorContext);
  if (!ctx) throw new Error('useEstimatorContext must be used within EstimatorContextProvider');
  return ctx;
}

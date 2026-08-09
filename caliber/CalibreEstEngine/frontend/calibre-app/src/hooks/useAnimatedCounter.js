import { useState, useEffect, useRef } from 'react';

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

export function useAnimatedCounter(target, duration = 1200, delay = 0) {
  const [count, setCount] = useState(0);
  const frameRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      startRef.current = null;
      const animate = (timestamp) => {
        if (!startRef.current) startRef.current = timestamp;
        const elapsed = timestamp - startRef.current;
        const progress = Math.min(elapsed / duration, 1);
        setCount(Math.floor(easeOutQuart(progress) * target));
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(animate);
        } else {
          setCount(target);
        }
      };
      frameRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, delay]);

  return count;
}

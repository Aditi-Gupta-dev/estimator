/* EVA Avatar — Feminine AI silhouette SVG component */
export function EVAAvatar({ size = 'md', animate = true, thinking = false }) {
  const sizeMap = {
    sm: 26,
    md: 38,
    lg: 48,
    xl: 80,
  };
  const px = sizeMap[size] || 38;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        animation: animate ? 'evaBreath 3s ease-in-out infinite' : 'none',
        flexShrink: 0,
      }}
      aria-label="EVA — Estimation Virtual Assistant"
    >
      <defs>
        <radialGradient id={`eva-head-${size}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="55%" stopColor="#7C6FFF" />
          <stop offset="100%" stopColor="#5B8EFF" />
        </radialGradient>
        <radialGradient id={`eva-glow-${size}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(124,111,255,0.35)" />
          <stop offset="100%" stopColor="rgba(91,142,255,0)" />
        </radialGradient>
        <linearGradient id={`eva-ring-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#7C6FFF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`eva-body-${size}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7C6FFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#5B8EFF" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* Outer glow */}
      <circle cx="40" cy="40" r="38" fill={`url(#eva-glow-${size})`} />

      {/* Rotating ring */}
      <circle
        cx="40"
        cy="40"
        r="35"
        fill="none"
        stroke={`url(#eva-ring-${size})`}
        strokeWidth="1.2"
        strokeDasharray="20 8 5 8"
        style={{
          animation: 'ringRotate 8s linear infinite',
          transformOrigin: '40px 40px',
        }}
      />

      {/* Inner ring (counter-rotate) */}
      <circle
        cx="40"
        cy="40"
        r="30"
        fill="none"
        stroke="rgba(0,212,255,0.18)"
        strokeWidth="0.8"
        strokeDasharray="10 6"
        style={{
          animation: 'ringRotateReverse 12s linear infinite',
          transformOrigin: '40px 40px',
        }}
      />

      {/* Neck / Shoulders */}
      <path
        d="M27 65 C27 58 32 54 40 54 C48 54 53 58 53 65 L56 72 L24 72 Z"
        fill={`url(#eva-body-${size})`}
      />

      {/* Neural circuit lines — hair motif */}
      <line x1="40" y1="10" x2="40" y2="4" stroke="rgba(0,212,255,0.4)" strokeWidth="0.8" />
      <line x1="32" y1="12" x2="28" y2="7" stroke="rgba(0,212,255,0.25)" strokeWidth="0.7" />
      <line x1="48" y1="12" x2="52" y2="7" stroke="rgba(0,212,255,0.25)" strokeWidth="0.7" />
      <circle cx="40" cy="4" r="1.5" fill="rgba(0,212,255,0.7)" />
      <circle cx="28" cy="7" r="1" fill="rgba(124,111,255,0.6)" />
      <circle cx="52" cy="7" r="1" fill="rgba(45,212,191,0.6)" />

      {/* Head */}
      <ellipse
        cx="40"
        cy="32"
        rx="14"
        ry="17"
        fill={`url(#eva-head-${size})`}
      />

      {/* Face highlight */}
      <ellipse
        cx="37"
        cy="26"
        rx="5"
        ry="7"
        fill="rgba(255,255,255,0.12)"
      />

      {/* Eyes */}
      <ellipse
        cx="34.5"
        cy="31"
        rx="2.2"
        ry="2.4"
        fill="rgba(0,212,255,0.95)"
        style={thinking ? { animation: 'bounce 0.8s infinite' } : {}}
      />
      <ellipse
        cx="45.5"
        cy="31"
        rx="2.2"
        ry="2.4"
        fill="rgba(0,212,255,0.95)"
        style={thinking ? { animation: 'bounce 0.8s infinite 0.15s' } : {}}
      />
      {/* Eye glow */}
      <ellipse cx="34.5" cy="31" rx="3.5" ry="3.8" fill="rgba(0,212,255,0.15)" />
      <ellipse cx="45.5" cy="31" rx="3.5" ry="3.8" fill="rgba(0,212,255,0.15)" />
      {/* Eye highlight dots */}
      <circle cx="35.5" cy="30" r="0.8" fill="rgba(255,255,255,0.9)" />
      <circle cx="46.5" cy="30" r="0.8" fill="rgba(255,255,255,0.9)" />

      {/* Subtle smile */}
      <path
        d="M36 37.5 Q40 40 44 37.5"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Chin accent */}
      <ellipse cx="40" cy="47" rx="3" ry="1.2" fill="rgba(0,212,255,0.2)" />

      {/* Thinking dots (visible when processing) */}
      {thinking && (
        <g>
          <circle cx="35" cy="64" r="2" fill="rgba(124,111,255,0.8)"
            style={{ animation: 'bounce 0.8s infinite' }} />
          <circle cx="40" cy="64" r="2" fill="rgba(124,111,255,0.8)"
            style={{ animation: 'bounce 0.8s infinite 0.2s' }} />
          <circle cx="45" cy="64" r="2" fill="rgba(124,111,255,0.8)"
            style={{ animation: 'bounce 0.8s infinite 0.4s' }} />
        </g>
      )}
    </svg>
  );
}

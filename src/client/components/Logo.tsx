// Original mascot: "Pip", a round little bird in a dealer visor holding two cards.

export function BirdMascot({ size = 120, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Pip the bird"
    >
      <defs>
        <radialGradient id="pip-body" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffe36e" />
          <stop offset="0.65" stopColor="#ffc531" />
          <stop offset="1" stopColor="#f39b12" />
        </radialGradient>
        <linearGradient id="pip-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4be08e" />
          <stop offset="1" stopColor="#1aa35a" />
        </linearGradient>
      </defs>
      {/* shadow */}
      <ellipse cx="60" cy="110" rx="30" ry="5" fill="rgba(20,8,60,0.25)" />
      {/* feet */}
      <path d="M50 102l-4 6M50 102l1 7M70 102l4 6M70 102l-1 7" stroke="#ff8a3d" strokeWidth="4" strokeLinecap="round" />
      {/* tail */}
      <path d="M22 78c-8-2-13-8-14-14 7 2 12 3 17 8z" fill="#f39b12" />
      {/* body */}
      <circle cx="60" cy="66" r="39" fill="url(#pip-body)" stroke="#d97f06" strokeWidth="2.5" />
      {/* belly */}
      <ellipse cx="60" cy="82" rx="25" ry="18" fill="#fff4c9" />
      {/* tuft */}
      <path d="M57 28c-2-8 2-13 7-15-1 5 0 8 3 11-4 0-7 1-10 4z" fill="#ffc531" stroke="#d97f06" strokeWidth="2" strokeLinejoin="round" />
      {/* visor */}
      <path d="M24 49c9-17 63-17 72 0l-3 6c-12-10-54-10-66 0z" fill="url(#pip-visor)" stroke="#0f7a40" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M30 48c10-9 50-9 60 0" stroke="#b5f5d1" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.8" />
      {/* eyes */}
      <circle cx="47" cy="63" r="9.5" fill="#fff" />
      <circle cx="73" cy="63" r="9.5" fill="#fff" />
      <circle cx="49" cy="64" r="5" fill="#2b2050" />
      <circle cx="71" cy="64" r="5" fill="#2b2050" />
      <circle cx="51" cy="62" r="1.8" fill="#fff" />
      <circle cx="73" cy="62" r="1.8" fill="#fff" />
      {/* cheeks */}
      <circle cx="37" cy="76" r="5" fill="#ff8fab" opacity="0.75" />
      <circle cx="83" cy="76" r="5" fill="#ff8fab" opacity="0.75" />
      {/* beak */}
      <path d="M53 72h14l-7 9z" fill="#ff8a3d" stroke="#d9661a" strokeWidth="2" strokeLinejoin="round" />
      {/* cards in wing */}
      <g transform="rotate(16 96 78)">
        <rect x="82" y="60" width="22" height="30" rx="4" fill="#fff" stroke="#2b2050" strokeWidth="2" />
        <path d="M93 69c-2.5-3.5-7 0-3.5 3.5L93 76l3.5-3.5c3.5-3.5-1-7-3.5-3.5z" fill="#ff4d6d" />
      </g>
      <g transform="rotate(-4 90 80)">
        <rect x="76" y="64" width="22" height="30" rx="4" fill="#fff" stroke="#2b2050" strokeWidth="2" />
        <path d="M87 71l5 6-5 6-5-6z" fill="#2b2050" />
      </g>
      {/* wing */}
      <path d="M74 86c6-10 20-12 24-6-2 9-14 14-24 6z" fill="#ffb81f" stroke="#d97f06" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={`wordmark ${className ?? ''}`}>
      <span className="wordmark-flock">Flock</span>
      <span className="wordmark-poker">Poker</span>
    </div>
  );
}

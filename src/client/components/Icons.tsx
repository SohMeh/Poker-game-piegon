// Minimal inline icon set (stroke icons, currentColor).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconMenu = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconShare = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="3" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </svg>
);
export const IconChat = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);
export const IconUsers = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
    <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2" />
  </svg>
);
export const IconList = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </svg>
);
export const IconCoins = (p: P) => (
  <svg {...base} {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
    <path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3" />
  </svg>
);
export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2" />
  </svg>
);
export const IconCrown = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden {...p}>
    <path
      d="M3 8.5l4.5 3.5L12 5l4.5 7L21 8.5 19 18H5z"
      fill="#ffd43b"
      stroke="#b77900"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="4.5" r="1.6" fill="#ffd43b" stroke="#b77900" strokeWidth="1.2" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconMinus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconSend = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 12l16-8-6 16-2.5-6.5z" />
  </svg>
);
export const IconMessage = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4c4.97 0 9 3.13 9 7s-4.03 7-9 7c-1 0-2-.13-2.9-.37L4 20l1.5-3.8C4.2 14.9 3 13.1 3 11c0-3.87 4.03-7 9-7z" />
  </svg>
);
export const IconWifiOff = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-3.2-2.1M2 8.5a15 15 0 0 1 4.2-2.6M22 8.5A15 15 0 0 0 11 4.5" />
    <circle cx="12" cy="19.5" r="0.8" />
  </svg>
);

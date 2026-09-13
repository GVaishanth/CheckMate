/** Inline icon set — tiny, consistent stroke style, no external assets. */

export interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false as const,
});

export const IconKnight = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 20c0-4 1-6.5 3.2-8.6L7 12.4c-1.2.5-2.4-.7-1.7-1.8l1-1.6C8.6 5.6 10.5 4 13.4 4l.2-1.6 1.7 1.4L17 2.6l.3 1.9C19.2 5.9 20 8.3 20 11.4c0 3 .1 5.9.2 8.6H7Z" />
    <circle cx="13.6" cy="8.2" r="0.4" fill="currentColor" />
  </svg>
);

export const IconBots = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5" />
    <path d="M2.5 12v4M21.5 12v4" />
  </svg>
);

export const IconLink = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="2.6" />
    <circle cx="17" cy="17" r="2.6" />
    <path d="M9.2 8.4l5.6 7.2M14.8 9.2V7h2.2M9.2 14.8H7v-2.2" />
  </svg>
);

export const IconPuzzle = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 4h4v1.8a1.8 1.8 0 1 0 3.6 0V4H20v4h-1.8a1.8 1.8 0 1 0 0 3.6H20v4h-4v1.9a1.8 1.8 0 1 0 3.6 0" />
    <path d="M10 20H4v-6h1.7a1.8 1.8 0 1 0 0-3.6H4V4h6" />
  </svg>
);

export const IconGauge = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 14a8 8 0 1 1 16 0" />
    <path d="M12 14l4-4" />
    <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHistory = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
    <path d="M12 8v4l2.6 1.6" />
  </svg>
);

export const IconSettings = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.4 6.5l1.9 1.4M17.7 16.1l1.9 1.4M2.8 14.5l2.3-.7M18.9 10.2l2.3-.7M4.4 17.5l1.9-1.4M17.7 7.9l1.9-1.4M2.8 9.5l2.3.7M18.9 13.8l2.3.7" transform="rotate(22 12 12)" />
  </svg>
);

export const IconFlip = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 4v13.5M7 4L4 7m3-3l3 3M17 20V6.5M17 20l3-3m-3 3l-3-3" />
  </svg>
);

export const IconFlag = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 21V4m0 1h11l-2.5 3.5L17 12H6" />
  </svg>
);

export const IconDraw = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="17" cy="7" r="2.5" />
    <circle cx="12" cy="17" r="2.5" />
    <path d="M8.8 8.8l2.2 6M15.2 8.8l-2.2 6" />
  </svg>
);

export const IconUndo = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 9h10a5 5 0 0 1 0 10h-4" />
    <path d="M4 9l4-4M4 9l4 4" />
  </svg>
);

export const IconList = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4.2" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.2" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.2" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCopy = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="11" height="11" rx="1.6" />
    <path d="M5 15H4.6A1.6 1.6 0 0 1 3 13.4V5.6A1.6 1.6 0 0 1 4.6 4h7.8A1.6 1.6 0 0 1 14 5.6V6" />
  </svg>
);

export const IconSound = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  </svg>
);

export const IconMute = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16.5 9.5l4 5M20.5 9.5l-4 5" />
  </svg>
);

export const IconDownload = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 4v11m0 0l-4-4m4 4l4-4M4 19h16" />
  </svg>
);

export const IconUpload = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 15V4m0 0L8 8m4-4l4 4M4 19h16" />
  </svg>
);

export const IconClose = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 5l14 14M19 5L5 19" />
  </svg>
);

/** Pen nib — THE ANNOTATOR, the post-game reviewer. */
export const IconQuill = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3c3 3.4 4.5 6.2 4.5 8.7a4.5 4.5 0 1 1-9 0C7.5 9.2 9 6.4 12 3z" />
    <circle cx="12" cy="13" r="1" />
    <path d="M12 14v3" />
  </svg>
);

export const IconBolt = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M13 2 5 13.5h5.5L10 22l8-11.5h-5.5L13 2Z" />
  </svg>
);

export const IconShield = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l7 2.8V12c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V5.8L12 3Z" />
  </svg>
);

export const IconCpu = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="1.6" />
    <rect x="9.5" y="9.5" width="5" height="5" />
    <path d="M9 2.8V6M15 2.8V6M9 18v3.2M15 18v3.2M2.8 9H6M2.8 15H6M18 9h3.2M18 15h3.2" />
  </svg>
);

export const IconWifiOff = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.2a5 5 0 0 1 6 0" />
    <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
    <path d="M3 3l18 18" />
  </svg>
);

export const IconPlay = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 4.8v14.4L19 12 7 4.8Z" />
  </svg>
);

export const IconTrophy = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M12 14v3M8.5 20h7M10 17h4" />
  </svg>
);

export const IconTarget = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconKeyboard = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="1.8" />
    <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 13.8h8" />
  </svg>
);

import React from 'react';

const S: React.SVGProps<SVGSVGElement> = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.65,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const IconCursor = () => (
  <svg {...S}>
    <path d="M3.5 2.5L12.5 8L8 9L6.5 13.5L3.5 2.5Z" />
  </svg>
);

export const IconSketch = () => (
  <svg {...S}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.2" strokeDasharray="2.2 1.6" />
    <circle cx="6.2" cy="6.2" r="2.1" />
    <path d="M7.8 9.8H12M9.9 7.7V11.9" />
  </svg>
);

export const IconExtrude = () => (
  <svg {...S}>
    <path d="M3 10.5L8 13L13 10.5V5.5L8 3L3 5.5V10.5Z" />
    <path d="M8 9.5V2.2M5.7 4.4L8 2.1L10.3 4.4" />
  </svg>
);

export const IconRevolve = () => (
  <svg {...S}>
    <path d="M8 2V14" strokeDasharray="1.8 1.6" />
    <path d="M4.2 5.2C2.3 6.3 2.3 9.2 4.8 10.3C7.4 11.4 11.2 11 12.8 9.2C13.9 7.9 13.2 6.1 11.2 5.2" />
    <path d="M10.9 3.6L13.1 5.3L10.5 6.6" />
  </svg>
);

export const IconCut = () => (
  <svg {...S}>
    <rect x="2.5" y="4.5" width="7.5" height="7.5" rx="1" />
    <rect x="6" y="2.5" width="7.5" height="7.5" rx="1" strokeDasharray="2 1.5" />
  </svg>
);

export const IconFillet = () => (
  <svg {...S}>
    <path d="M3 13V8C3 5.24 5.24 3 8 3H13" />
    <path d="M3 3H6M3 3V6" strokeOpacity="0.45" />
  </svg>
);

export const IconChamfer = () => (
  <svg {...S}>
    <path d="M3 13V7.5L7.5 3H13" />
    <path d="M3 5.5V3H5.5" strokeOpacity="0.45" />
  </svg>
);

export const IconShell = () => (
  <svg {...S}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.5" />
    <rect x="4.8" y="4.8" width="6.4" height="6.4" rx="0.8" />
  </svg>
);

export const IconHole = () => (
  <svg {...S}>
    <circle cx="8" cy="8" r="5.3" />
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5V3.2M8 12.8V14.5M1.5 8H3.2M12.8 8H14.5" />
  </svg>
);

export const IconPattern = () => (
  <svg {...S}>
    <rect x="2.2" y="2.2" width="4.4" height="4.4" rx="0.8" />
    <rect x="9.4" y="2.2" width="4.4" height="4.4" rx="0.8" />
    <rect x="2.2" y="9.4" width="4.4" height="4.4" rx="0.8" />
    <rect x="9.4" y="9.4" width="4.4" height="4.4" rx="0.8" />
  </svg>
);

export const IconMirror = () => (
  <svg {...S}>
    <path d="M8 2V14" strokeDasharray="2 1.6" />
    <path d="M5.8 4.5L2.3 11.5H5.8V4.5Z" />
    <path d="M10.2 4.5L13.7 11.5H10.2V4.5Z" />
  </svg>
);

export const IconBox = () => (
  <svg {...S}>
    <path d="M8 1.8L13.8 4.9V11.1L8 14.2L2.2 11.1V4.9L8 1.8Z" />
    <path d="M2.2 4.9L8 8L13.8 4.9M8 8V14.2" />
  </svg>
);

export const IconCylinder = () => (
  <svg {...S}>
    <ellipse cx="8" cy="4.2" rx="5" ry="2.1" />
    <path d="M3 4.2V11.8C3 13 5.24 13.9 8 13.9C10.76 13.9 13 13 13 11.8V4.2" />
  </svg>
);

export const IconSphere = () => (
  <svg {...S}>
    <circle cx="8" cy="8" r="5.8" />
    <ellipse cx="8" cy="8" rx="5.8" ry="2.3" />
    <path d="M8 2.2C9.8 4 9.8 12 8 13.8" />
  </svg>
);

export const IconCone = () => (
  <svg {...S}>
    <path d="M8 2.2L3 11.8M8 2.2L13 11.8" />
    <ellipse cx="8" cy="11.8" rx="5" ry="2" />
  </svg>
);

export const IconGear = () => (
  <svg {...S}>
    <circle cx="8" cy="8" r="2.3" />
    <path d="M8 1.8V3.3M8 12.7V14.2M1.8 8H3.3M12.7 8H14.2M3.6 3.6L4.7 4.7M11.3 11.3L12.4 12.4M12.4 3.6L11.3 4.7M4.7 11.3L3.6 12.4" />
    <circle cx="8" cy="8" r="4.7" />
  </svg>
);

export const IconSection = () => (
  <svg {...S}>
    <path d="M2.5 5.5L7.5 3L12.5 5.5V11L7.5 13.5L2.5 11V5.5Z" />
    <path d="M1.8 8H14.2" strokeDasharray="2.2 1.5" />
  </svg>
);

export const IconRuler = () => (
  <svg {...S}>
    <path d="M2.2 11.3L11.3 2.2L13.8 4.7L4.7 13.8L2.2 11.3Z" />
    <path d="M5 8.5L6.4 9.9M7.2 6.3L8.6 7.7M9.4 4.1L10.8 5.5" />
  </svg>
);

export const IconUndo = () => (
  <svg {...S}>
    <path d="M6 4L2.5 7.5L6 11" />
    <path d="M3 7.5H9.5C11.985 7.5 14 9.515 14 12V12.5" />
  </svg>
);

export const IconRedo = () => (
  <svg {...S}>
    <path d="M10 4L13.5 7.5L10 11" />
    <path d="M13 7.5H6.5C4.015 7.5 2 9.515 2 12V12.5" />
  </svg>
);

export const IconFolder = () => (
  <svg {...S}>
    <path d="M2 4.2C2 3.54 2.54 3 3.2 3H6.3L7.8 4.8H12.8C13.46 4.8 14 5.34 14 6V11.8C14 12.46 13.46 13 12.8 13H3.2C2.54 13 2 12.46 2 11.8V4.2Z" />
  </svg>
);

export const IconDownload = () => (
  <svg {...S}>
    <path d="M8 2.5V10.5M5 7.8L8 10.8L11 7.8" />
    <path d="M2.5 12.2V13C2.5 13.44 2.86 13.8 3.3 13.8H12.7C13.14 13.8 13.5 13.44 13.5 13V12.2" />
  </svg>
);

export const IconCheck = () => (
  <svg {...S}>
    <path d="M2.8 8.3L6.3 11.8L13.2 4.5" />
  </svg>
);

export const IconSpark = () => (
  <svg {...S}>
    <path d="M9 1.8L3.5 9H8L7 14.2L12.5 7H8L9 1.8Z" />
  </svg>
);

export const IconFit = () => (
  <svg {...S}>
    <path d="M2.5 6V2.5H6M10 2.5H13.5V6M13.5 10V13.5H10M6 13.5H2.5V10" />
  </svg>
);

export const IconTrash = () => (
  <svg {...S}>
    <path d="M3 4.5H13M6.2 4.5V3C6.2 2.56 6.56 2.2 7 2.2H9C9.44 2.2 9.8 2.56 9.8 3V4.5M4.3 4.5L4.9 13C4.94 13.5 5.36 13.8 5.86 13.8H10.14C10.64 13.8 11.06 13.5 11.1 13L11.7 4.5" />
  </svg>
);

export const IconSun = () => (
  <svg {...S}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.8V3.2M8 12.8V14.2M1.8 8H3.2M12.8 8H14.2M3.6 3.6L4.6 4.6M11.4 11.4L12.4 12.4M12.4 3.6L11.4 4.6M4.6 11.4L3.6 12.4" />
  </svg>
);

export const IconMoon = () => (
  <svg {...S}>
    <path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8A5.5 5.5 0 1 0 13.2 9.8Z" />
  </svg>
);

export const IconPlus = () => (
  <svg {...S}>
    <path d="M8 3V13M3 8H13" />
  </svg>
);

export const IconChevron = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 4.5L6 7.5L9 4.5" />
  </svg>
);

export const IconEye = ({ off }: { off?: boolean }) =>
  off ? (
    <svg {...S}>
      <path d="M2 2L14 14" />
      <path d="M6.5 6.6A2 2 0 0 0 9.4 9.5" />
      <path d="M3.6 5.3C2.5 6.2 1.8 7.4 1.5 8C2.6 10.4 5.1 12 8 12C9.2 12 10.3 11.7 11.3 11.1M6.3 4.2C6.8 4.1 7.4 4 8 4C10.9 4 13.4 5.6 14.5 8C14.1 8.8 13.5 9.6 12.8 10.2" />
    </svg>
  ) : (
    <svg {...S}>
      <path d="M1.5 8C2.6 5.6 5.1 4 8 4C10.9 4 13.4 5.6 14.5 8C13.4 10.4 10.9 12 8 12C5.1 12 2.6 10.4 1.5 8Z" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );

export const IconRotate = () => (
  <svg {...S}>
    <path d="M13 5.5V2.5H10" />
    <path d="M12.8 3A6 6 0 1 0 13.8 9" />
  </svg>
);

export const IconCopy = () => (
  <svg {...S}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" />
    <path d="M3.5 10.5H3C2.45 10.5 2 10.05 2 9.5V3C2 2.45 2.45 2 3 2H9.5C10.05 2 10.5 2.45 10.5 3V3.5" />
  </svg>
);

export const IconCube3D = () => (
  <svg {...S}>
    <path d="M8 1.8L13.8 5V11L8 14.2L2.2 11V5L8 1.8Z" />
    <path d="M2.2 5L8 8.2L13.8 5M8 8.2V14.2" />
  </svg>
);

export const IconDots = () => (
  <svg {...S}>
    <circle cx="3.2" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12.8" cy="8" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSidebarLeft = () => (
  <svg {...S}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.6" />
    <path d="M6.2 2.5V13.5" />
  </svg>
);

export const IconSidebarRight = () => (
  <svg {...S}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.6" />
    <path d="M9.8 2.5V13.5" />
  </svg>
);

export const IconPalette = () => (
  <svg {...S}>
    <path d="M8 2C4.69 2 2 4.46 2 7.5C2 10.54 4.69 13 8 13C8.83 13 9.5 12.33 9.5 11.5C9.5 11.12 9.35 10.78 9.11 10.52C8.88 10.27 8.75 9.95 8.75 9.58C8.75 8.75 9.42 8.08 10.25 8.08H11.5C13.16 8.08 14.5 6.74 14.5 5.08C14.5 3.38 11.59 2 8 2Z" />
    <circle cx="5.2" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="7.6" cy="4.8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10.4" cy="5.4" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRefresh = () => (
  <svg {...S}>
    <path d="M13.5 3V6.5H10" />
    <path d="M2.5 13V9.5H6" />
    <path d="M3.2 6A5.5 5.5 0 0 1 13.2 6.3M12.8 10A5.5 5.5 0 0 1 2.8 9.7" />
  </svg>
);

export const IconSliders = () => (
  <svg {...S}>
    <path d="M2.5 4.2H9M11.5 4.2H13.5M2.5 8H4.5M7 8H13.5M2.5 11.8H10M12.5 11.8H13.5" />
    <circle cx="10.2" cy="4.2" r="1.4" />
    <circle cx="5.8" cy="8" r="1.4" />
    <circle cx="11.2" cy="11.8" r="1.4" />
  </svg>
);

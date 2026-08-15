/**
 * The handful of icons the navigation needs, as inline SVG.
 *
 * Inline rather than an icon package: four glyphs do not justify a dependency,
 * and drawn in `currentColor` they follow the light and dark theme by
 * themselves. They are decorative — the label below each one carries the
 * meaning — so they are hidden from assistive technology.
 */

interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export function CatalogueIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  );
}

export function ScanIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 9v6M11 9v6M14 9v6M17 9v6" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4.5l2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 16.48l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 14.2a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V19.7a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H4.3a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.05A1.8 1.8 0 1 1 7.97 4.6l.05.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.5a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.1a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.9z" />
    </svg>
  );
}

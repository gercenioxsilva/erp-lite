interface Props {
  size?:    'sm' | 'md' | 'lg' | 'xl';
  variant?: 'full' | 'mark';
  theme?:   'light' | 'dark';
}

const HEIGHTS = { sm: 28, md: 36, lg: 48, xl: 64 };

export function GaxLogo({ size = 'md', variant = 'full', theme = 'light' }: Props) {
  const h       = HEIGHTS[size];
  const ratio   = h / 44;
  const textCol = theme === 'dark' ? '#f1f5f9' : '#0f172a';
  const subCol  = '#94a3b8';
  const viewW   = variant === 'mark' ? 44 : 188;
  const svgW    = viewW * ratio;

  return (
    <svg
      width={svgW}
      height={h}
      viewBox={`0 0 ${viewW} 44`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="GAX Enterprise ERP"
    >
      <defs>
        {/* Indigo → Cyan gradient — modern SaaS palette */}
        <linearGradient id="gax-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>

        {/* Subtle inner glow on icon */}
        <radialGradient id="gax-glow" cx="30%" cy="25%" r="60%">
          <stop stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Icon: rounded square ─────────────────────────────────────────── */}
      <rect x="0" y="2" width="40" height="40" rx="10" fill="url(#gax-g)" />
      <rect x="0" y="2" width="40" height="40" rx="10" fill="url(#gax-glow)" />

      {/* Three stacked bars — ERP data / dashboard motif
          Widths (22 / 16 / 20) create visual rhythm; opacity steps add depth */}
      <rect x="9" y="11" width="22" height="5.5" rx="2.75" fill="white" />
      <rect x="9" y="20" width="16" height="5.5" rx="2.75" fill="white" opacity="0.80" />
      <rect x="9" y="29" width="20" height="5.5" rx="2.75" fill="white" opacity="0.60" />

      {/* Accent dot on the right end of first bar */}
      <circle cx="34" cy="13.75" r="2.5" fill="white" opacity="0.45" />

      {/* ── Wordmark ─────────────────────────────────────────────────────── */}
      {variant === 'full' && (
        <>
          <text
            x="52"
            y="30"
            fill={textCol}
            fontSize="27"
            fontWeight="800"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
            letterSpacing="-1.2"
          >
            GAX
          </text>
          <text
            x="53"
            y="40"
            fill={subCol}
            fontSize="7.5"
            fontWeight="700"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
            letterSpacing="4"
          >
            ENTERPRISE
          </text>
        </>
      )}
    </svg>
  );
}

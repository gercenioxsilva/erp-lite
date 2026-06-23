interface Props {
  size?:    'sm' | 'md' | 'lg' | 'xl';
  variant?: 'full' | 'mark';
  theme?:   'light' | 'dark';
}

const HEIGHTS = { sm: 28, md: 36, lg: 48, xl: 64 };

export function GaxLogo({ size = 'md', variant = 'full', theme = 'light' }: Props) {
  const h      = HEIGHTS[size];
  const ratio  = h / 44;
  const textCol = theme === 'dark' ? '#f1f5f9' : '#0D1B2A';
  const viewW  = variant === 'mark' ? 44 : 220;
  const svgW   = viewW * ratio;

  return (
    <svg
      width={svgW}
      height={h}
      viewBox={`0 0 ${viewW} 44`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Orquestra ERP"
    >
      <defs>
        {/* Blue → Cyan gradient — Orquestra ERP brand */}
        <linearGradient id="orq-g" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#3B5CE4" />
          <stop offset="100%" stopColor="#00B4D8" />
        </linearGradient>

        <radialGradient id="orq-glow" cx="30%" cy="25%" r="60%">
          <stop stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Icon: circular arc with connected nodes ────────────────────────── */}

      {/* Thick arc — 270° ring, gap at upper-right to lower-right quadrant */}
      <path
        d="M 34,34 A 17,17 0 1 1 34,10"
        fill="none"
        stroke="url(#orq-g)"
        strokeWidth="8"
        strokeLinecap="round"
      />

      {/* Inner glow overlay on arc */}
      <path
        d="M 34,34 A 17,17 0 1 1 34,10"
        fill="none"
        stroke="url(#orq-glow)"
        strokeWidth="8"
        strokeLinecap="round"
      />

      {/* Center node */}
      <circle cx="22" cy="22" r="3.2" fill="url(#orq-g)" />

      {/* Arm to lower-right node */}
      <line x1="22" y1="22" x2="31" y2="31" stroke="url(#orq-g)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="34" r="3" fill="#00B4D8" />

      {/* Arm to upper-right node */}
      <line x1="22" y1="22" x2="31" y2="13" stroke="url(#orq-g)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="10" r="3" fill="#3B5CE4" />

      {/* ── Wordmark ──────────────────────────────────────────────────────── */}
      {variant === 'full' && (
        <>
          <text
            x="54"
            y="29"
            fill={textCol}
            fontSize="22"
            fontWeight="800"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
            letterSpacing="-0.8"
          >
            Orquestra
          </text>
          <text
            x="54"
            y="41"
            fill="#00B4D8"
            fontSize="8"
            fontWeight="700"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
            letterSpacing="4"
          >
            ERP
          </text>
        </>
      )}
    </svg>
  );
}

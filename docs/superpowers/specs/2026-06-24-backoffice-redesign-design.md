# Backoffice Redesign — Bento Editorial

**Date**: 2026-06-24
**Project**: erp-lite / apps/backoffice
**Scope**: Full visual redesign of the React/Vite SPA backoffice

---

## Direction

**Bento Editorial** — asymmetric bento grid on the dashboard, editorial typography hierarchy across all pages. Dark sidebar, light content area, Inter font.

Chosen from three proposals (Bento Editorial, Neon Brutalism, Swiss Clean) after user review.

---

## Design Tokens (`src/index.css` — `:root`)

| Token | Value | Purpose |
|---|---|---|
| `--primary` | `#3B5CE4` | Brand blue |
| `--bg` | `#F4F6FA` | Page background |
| `--surface` | `#ffffff` | Card/panel fill |
| `--sidebar-bg` | `#0c1424` | Dark sidebar |
| `--font` | `Inter, system-ui` | UI font (loaded from Google Fonts) |
| `--text-hero` | `40px / 800` | Bento hero number |
| `--text-2xl` | `28px / 700` | Secondary metric |
| `--r-lg` | `14px` | Card radius |
| `--shadow-sm` | `0 1px 4px + 0 4px 16px` | Card shadow |

---

## Component Changes

### Sidebar (Layout.tsx)

- **Before**: emoji chars inline in nav links; inline style={{}} on footer buttons.
- **After**: 10 inline SVG icons (18x18, currentColor, strokeWidth 1.5) wrapped in span.nav-icon; footer buttons use .sidebar-footer-btn class; role shown via .footer-role span.
- Active item: background rgba(59,92,228,.22), icon color #7B9AF5.
- Hover: rgba(255,255,255,.07) background, no border.

### Dashboard (DashboardPage.tsx)

- **Before**: two uniform .stat-card tiles.
- **After**:
  - .bento-grid (3-col, 14px gap)
  - .bento-hero (spans 2 cols, dark gradient, two blurred orbs, --text-hero number)
  - Secondary card for stock alerts with colored badge
  - .quick-links auto-fill grid linking to all 7 sections
  - Low-stock table preserved, now uses .card-header class

### Global CSS additions

- .bento-grid, .bento-hero, .bento-card, .bento-label, .bento-value, .bento-value-md, .bento-sub
- .bento-badge-ok / .bento-badge-warn
- .bento-icon-{blue,green,red,cyan}
- .quick-links, .quick-link (lift on hover)
- .sidebar-footer-btn, .footer-role
- Extended badge system: draft, issued, cancelled, confirmed, pending, paid, overdue
- Enhanced table: uppercase TH, border-bottom on TD, hover row tint
- Auth/login/modal CSS unchanged

---

## Typography

Inter loaded from Google Fonts (weights 400/500/600/700/800, font-display:swap), preconnect links in index.html.

Text scale: --text-xs (11px) to --text-hero (40px) in 8 steps.

---

## Files Modified

| File | Change |
|---|---|
| apps/backoffice/index.html | Inter font link |
| apps/backoffice/src/index.css | Full token + component CSS redesign |
| apps/backoffice/src/components/Layout.tsx | SVG icons, class-based footer |
| apps/backoffice/src/pages/DashboardPage.tsx | Bento grid + quick links |

---

## Non-decisions

- Other pages use existing table/card structure restyled by global CSS. No per-page changes needed.
- No new npm packages. Icons are inline SVG.
- Login split-panel (ls-*) CSS was already present and unchanged.

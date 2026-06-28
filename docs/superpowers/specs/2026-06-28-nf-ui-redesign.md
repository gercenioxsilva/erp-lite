# NF-e / NFS-e UI Redesign + Design System

**Date:** 2026-06-28  
**Approach:** B — Elevate the Brand  
**Scope:** `apps/backoffice`

---

## Overview

Three parallel workstreams delivered together:

1. **Design System (DS)** — add semantic tokens to `index.css`, extract typed React components into `src/ds/`
2. **NF-e Produtos** — replace the current side-drawer creation form with a full-page progressive-disclosure form at `/invoices/new`
3. **NFS-e Serviços** — add a KPI summary bar to the list page and redesign the detail drawer with a proper timeline component

No new npm dependencies. All existing pages remain untouched (they continue using current classes). New screens consume DS components exclusively.

---

## 1. Design System

### 1.1 Token additions to `src/index.css`

Appended to the existing `:root` block — existing tokens are unchanged.

```css
/* ── Spacing scale ─────────────────────────────────── */
--space-1:  4px;   --space-2:  8px;   --space-3: 12px;
--space-4: 16px;   --space-5: 20px;   --space-6: 24px;
--space-8: 32px;   --space-10: 40px;  --space-12: 48px;

/* ── Semantic status tokens ────────────────────────── */
--status-authorized-bg:   #dcfce7;  --status-authorized-fg:   #166534;
--status-rejected-bg:     #fee2e2;  --status-rejected-fg:     #991b1b;
--status-pending-bg:      #fef3c7;  --status-pending-fg:      #92400e;
--status-processing-bg:   #dbeafe;  --status-processing-fg:   #1e40af;
--status-draft-bg:        #f1f5f9;  --status-draft-fg:        #64748b;
--status-issued-bg:       #dbeafe;  --status-issued-fg:       #1d4ed8;
--status-cancelled-bg:    #fee2e2;  --status-cancelled-fg:    var(--danger);

/* ── Step progress ─────────────────────────────────── */
--step-connector:  #e4e8ee;
--step-active:     var(--primary);
--step-done:       var(--success);
--step-bar-height: 56px;   /* height of the StepProgress sticky bar */
```

### 1.2 Component library — `src/ds/`

```
src/ds/
  components/
    Badge.tsx          Badge.css
    StatusPill.tsx     StatusPill.css
    KPICard.tsx        KPICard.css
    SectionCard.tsx    SectionCard.css
    StepProgress.tsx   StepProgress.css
    DataTable.tsx      DataTable.css
    Timeline.tsx       Timeline.css
    Drawer.tsx         Drawer.css
  index.ts
```

#### `<Badge>`
Typed replacement for `.badge-*` classes.
```tsx
type BadgeVariant = 'product' | 'service' | 'asset' | 'raw_material'
  | 'active' | 'inactive' | 'draft' | 'issued' | 'cancelled'
  | 'confirmed' | 'pending' | 'paid' | 'overdue' | 'low';
<Badge variant={variant}>{children}</Badge>
```
Maps each variant to its existing CSS class. No visual change — just typed.

#### `<StatusPill>`
Single source of truth for NF-e / NFS-e fiscal status labels and colors. Replaces the `NFE_STATUS_CONFIG` object spread across `InvoicesPage` and the `badge-*` hacks in `NfsePage`.
```tsx
type FiscalStatus = 'authorized' | 'rejected' | 'pending' | 'processing';
<StatusPill status={status} spinning? onClick? />
```
Uses `--status-*` tokens. Shows a CSS-only spinner when `spinning` is true (pending/processing states). Clickable variant wraps in a `<button>`.

#### `<KPICard>`
```tsx
<KPICard
  label="Autorizadas"
  value={42}
  icon={<CheckIcon />}
  iconVariant="green"
  sub="este mês"
  active={filterStatus === 'authorized'}
  onClick={() => setFilterStatus('authorized')}
/>
```
Extends the existing `.bento-card` / `.bento-icon-*` token set. `active` adds a `--primary` border. Clickable to set a filter.

#### `<SectionCard>`
Wrapper for each step in the progressive NF-e form.
```tsx
<SectionCard
  step={1}
  title="Origem"
  description="Pedido e cliente"
  unlocked={true}
>
  {children}
</SectionCard>
```
When `unlocked=false`: renders the header with step number + lock icon, content is hidden, card has reduced opacity. When `unlocked=true`: content fades in with a 200ms CSS transition.

#### `<StepProgress>`
Sticky bar at top of the NF-e page.
```tsx
type Step = { label: string; description: string };
<StepProgress steps={STEPS} currentStep={currentStep} />
```
Each step shows as a numbered circle + label. States: `done` (green ✓), `active` (blue filled), `locked` (gray outlined). Connected by a horizontal line. Scrolls horizontally on mobile.

#### `<DataTable>`
```tsx
<DataTable
  columns={columns}
  rows={rows}
  onRowClick?={fn}
  loading?={bool}
  emptyState?={ReactNode}
/>
```
Handles: loading skeleton (3 ghost rows), empty state slot, row hover, row click. Replaces the 4+ inline `<table>` definitions across the app.

#### `<Timeline>`
```tsx
type TimelineEvent = {
  type: string;
  statusCode: string | null;
  protocol: string | null;
  rejectReason: string | null;
  createdAt: string;
};
<Timeline events={events} />
```
Vertical timeline: colored dot (green/red/amber by event type) → connector line → label + code badge + timestamp. Rejected events show `rejectReason` in a `--status-rejected-bg` inset. Empty state: "Nenhum evento registrado" in muted text.

#### `<Drawer>`
Typed wrapper that handles overlay + drawer DOM structure, close-on-backdrop, focus trap, and header/body/footer slots.
```tsx
<Drawer open={open} onClose={onClose} width="min(560px, 96vw)" title="NFS-e #1042">
  <Drawer.Body>{children}</Drawer.Body>
  <Drawer.Footer>{actions}</Drawer.Footer>
</Drawer>
```

---

## 2. NF-e Produtos — Full-Page Progressive Form

### 2.1 Route change

| Route | Component | Change |
|---|---|---|
| `/invoices` | `InvoicesPage` | List only; creation drawer removed |
| `/invoices/new` | `InvoiceNewPage` | **New** full-page form |

`InvoicesPage` light cleanup:
- Filters collapsed behind a "Filtros ▾" toggle (collapsed by default)
- NF-e status column uses `<StatusPill>` instead of inline button
- Action column: icon-only buttons with tooltips

### 2.2 `InvoiceNewPage` layout

Two-column CSS Grid:
```css
.invoice-new-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-8);
  align-items: start;
}
@media (max-width: 900px) {
  .invoice-new-layout { grid-template-columns: 1fr; }
}
```

**Sticky page header** (above grid):
- Back link "← Notas Fiscais" → navigates to `/invoices`
- Title "Nova NF-e de Produtos"
- Ambiente badge (HML/PRD) using existing `.env-badge` classes

**Sticky step progress bar** (`position: sticky; top: 0; z-index: 10`):
Steps: `Origem · Itens · Fiscal · Impostos · Revisar`

### 2.3 Steps and unlock logic

| Step | Title | Unlocks when |
|---|---|---|
| ① Origem | "Origem — Pedido e cliente" | Always open |
| ② Itens | "Itens da nota" | `formClientId !== ''` |
| ③ Fiscal | "Regime fiscal e destino" | `formItems.some(it => it.name && Number(it.quantity) > 0)` |
| ④ Impostos | "Cálculo de impostos" | `formTaxRegime !== '' && formDestState.length === 2` |
| ⑤ Revisar | "Revisão e emissão" | `taxResult !== null` |

On unlock: smooth scroll to the newly unlocked section (`scrollIntoView({ behavior: 'smooth', block: 'nearest' })`).

#### Step ① — Origem
- `<select>` Pedido (optional, auto-fills client + items)
- `<select>` Cliente * (required)
- `<input>` Série (default "1", max 10 chars)

#### Step ② — Itens
- `<DataTable>` columns: Material, Qtd, Preço Unit., NCM, CFOP, Total, ×
- Material column: `<select>` from catalog; free-text name input shown if no material selected
- "+ Adicionar item" button below table

#### Step ③ — Fiscal
- `<select>` Regime tributário
- `<input>` Estado destino (2-char, uppercase enforced)
- `<textarea>` Observações (optional)

#### Step ④ — Impostos
- "⊕ Calcular impostos" button (full width, secondary style)
- Loading: spinner + "Calculando…"
- Result: per-item accordion (collapsed, expands to ICMS/PIS/COFINS/IPI per line) + summary totals
- Error: `<Alert variant="error">` with API message

#### Step ⑤ — Revisar
- Read-only summary: Cliente, Pedido ref, Nº itens, Regime, Estado destino
- Grand total in `--text-2xl` + `--primary` color
- CTA buttons matching the sidebar

### 2.4 Summary sidebar

```
RESUMO
─────────────────────────
Subtotal          R$ 0,00
ICMS embutido     —
PIS               —
COFINS            —
Carga tributária  —
─────────────────────────
Total             R$ 0,00

[Criar Rascunho]
[Emitir NF-e →]
```

- `position: sticky; top: calc(var(--step-bar-height) + var(--space-4))`
- Tax values show `—` (muted) until calculation; animate in with opacity + transform on completion
- Mobile (≤900px): sidebar below form; `position: fixed; bottom: 0` bar shows total + "Emitir" button; tapping expands to bottom sheet

### 2.5 Post-save navigation

- **Criar Rascunho**: navigate to `/invoices` on success
- **Emitir NF-e**: production confirmation modal (existing guard) → emit → navigate to `/invoices`

### 2.6 State removed from `InvoicesPage`

The following are deleted (moved to `InvoiceNewPage`):
- All form state variables (`formClientId`, `formOrderId`, `formItems`, `formTaxRegime`, `formDestState`, `taxResult`, `calcTaxLoad`, `calcTaxError`, `formError`, `saving`, `drawerOpen`)
- Functions: `openCreate`, `addItem`, `removeItem`, `updateItem`, `handleCalculateTaxes`, `handleSave`, `handleOrderChange`
- Sub-components: `NfeStatusBadge`, `NfeStatusCard` → replaced by `<StatusPill>` from DS

---

## 3. NFS-e Serviços — Improved List + Detail

### 3.1 Page structure

```
Page header: "NFS-e Serviços"          [Filtros ▾]
KPI bar (4 cards)
Filter bar (collapsed by default)
DataTable
Pagination
Detail Drawer
```

### 3.2 KPI bar

Four `<KPICard>` in `grid-template-columns: repeat(4, 1fr)` (2×2 on mobile).

| Card | Icon variant | Derived from | Click |
|---|---|---|---|
| Autorizadas | green | count of `nfse_status === 'authorized'` | `setFilterStatus('authorized')` |
| Pendentes | amber | count of pending + processing | `setFilterStatus('pending')` |
| Rejeitadas | red | count of `nfse_status === 'rejected'` | `setFilterStatus('rejected')` |
| Valor total | blue | sum of `amount` for current page | no filter |

Counts derived client-side from the current page (`per_page=20`). They reflect the visible page only, not all records — intentional; no extra API call. If the product later needs aggregate totals, a dedicated `/v1/nfse/stats` endpoint should be added.

### 3.3 DataTable columns

| Column | Width | Notes |
|---|---|---|
| Cliente | flex | `font-weight: 500` |
| Descrição | 240px | truncated, ellipsis |
| Valor | 110px | bold, BRL format |
| ISS | 110px | value + rate muted sub-text |
| Nº NFS-e | 90px | monospace, `—` if not authorized |
| Status | 130px | `<StatusPill>` |
| Data | 90px | `dd/MM/yyyy` |

Pending/processing rows: `.nfse-row--pulsing` CSS class applies `opacity` keyframe animation (0.6s ease-in-out infinite alternate, 1 → 0.7).

### 3.4 Detail drawer

Uses `<Drawer>` DS component. Width: `min(560px, 96vw)`.

**Header:**
- Title: `NFS-e #1042`
- Sub-header: `client_name · dd/MM/yyyy`

**Status card** (top of body):
- Full-width card using `--status-*` bg/fg tokens
- `<StatusPill>` at 15px font-size
- NFS-e number (monospace, bold) — hidden if not authorized
- Código de verificação — hidden if null
- Authorization date — hidden if null
- "↓ Visualizar PDF" `<a>` button — hidden if `nfse_pdf_url` null
- Reject reason in `--status-rejected-bg` inset if rejected
- Spinner + "Atualizando…" when pending/processing and drawer is polling

**Field grid:**
```
Cliente        | Código de serviço
Descrição      (full width)
Valor          | ISS (valor + alíquota)
Período        (full width, only if period set)
```
Uses existing `.field` and `.field-row` classes.

**Events timeline:**
Section divider "HISTÓRICO DE EVENTOS" (uppercase, muted, 11px).
`<Timeline events={detail.events} />`

**Footer:**
- Rejected: `[Reemitir]` (primary, left) + `[Fechar]` (secondary)
- Otherwise: `[Fechar]` only

### 3.5 Polling

No logic changes. Existing `setInterval` at 3s for pending/processing states. Visual improvement only: spinner + caption in status card while polling.

---

## 4. File change summary

### New files
```
src/ds/components/Badge.tsx / Badge.css
src/ds/components/StatusPill.tsx / StatusPill.css
src/ds/components/KPICard.tsx / KPICard.css
src/ds/components/SectionCard.tsx / SectionCard.css
src/ds/components/StepProgress.tsx / StepProgress.css
src/ds/components/DataTable.tsx / DataTable.css
src/ds/components/Timeline.tsx / Timeline.css
src/ds/components/Drawer.tsx / Drawer.css
src/ds/index.ts
src/pages/invoices/InvoiceNewPage.tsx
src/pages/invoices/InvoiceNewPage.css
```

### Modified files
```
src/index.css                          ← append token groups
src/App.tsx                            ← add /invoices/new route
src/pages/invoices/InvoicesPage.tsx    ← remove creation drawer, filter toggle, StatusPill
src/pages/nfse/NfsePage.tsx            ← KPI bar, DataTable, StatusPill, Drawer, Timeline
```

---

## 5. Out of scope

- Migration of other pages to DS components — deferred
- Dark mode tokens — not in this deliverable
- NFS-e creation form — auto-generated; no create flow planned
- E2E / Playwright tests — separate task

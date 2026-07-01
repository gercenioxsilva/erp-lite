import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ProductPicker.css';

/* ── Types ─────────────────────────────────────────────────────────────── */
export interface ProductPickerOption {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  /** When 'kit', the option shows a small badge (see kitLabel). */
  type?: string | null;
}

type Props = {
  options: ProductPickerOption[];
  value: string;                       // selected material_id ('' = none)
  onChange: (id: string) => void;
  placeholder?: string;                // search placeholder shown when nothing is selected
  emptyLabel?: string;                 // shown when the query matches no product
  ariaLabel?: string;
  id?: string;
  kitLabel?: string;                   // badge text shown next to options whose type === 'kit'
};

/* ── Search helpers ────────────────────────────────────────────────────── */
/** Lowercase + strip diacritics so "algodao" matches "algodão". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Filters products by name, SKU and description. A term that appears only in
 * the description still surfaces the product — accent- and case-insensitive.
 */
export function filterProducts(
  options: ProductPickerOption[],
  query: string,
): ProductPickerOption[] {
  const q = normalize(query.trim());
  if (!q) return options;
  return options.filter(o => {
    const haystack = normalize(`${o.name} ${o.sku} ${o.description ?? ''}`);
    return haystack.includes(q);
  });
}

function labelFor(opt: ProductPickerOption): string {
  return `${opt.sku} — ${opt.name}`;
}

/* ── Component ─────────────────────────────────────────────────────────── */
export function ProductPicker({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  ariaLabel,
  id,
  kitLabel,
}: Props) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(0);
  const rootRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => options.find(o => o.id === value) ?? null,
    [options, value],
  );
  const results = useMemo(() => filterProducts(options, query), [options, query]);

  /* ── Portal positioning ──────────────────────────────────────────────────
     The list renders in a <body> portal so it escapes the `overflow` clipping
     of ancestor tables/cards. We anchor it to the input's viewport rect on
     every open, scroll and resize, flipping above when there's no room below. */
  const [coords, setCoords] = useState<{
    left: number; width: number; maxHeight: number;
    top?: number; bottom?: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return; }

    function place() {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const GAP = 2;
      const MIN_HEIGHT = 140;
      const DESIRED_HEIGHT = 440;
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const flipUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
      const available = flipUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(MIN_HEIGHT, Math.min(DESIRED_HEIGHT, available));
      setCoords(
        flipUp
          ? { left: rect.left, width: rect.width, maxHeight, bottom: window.innerHeight - rect.top + GAP }
          : { left: rect.left, width: rect.width, maxHeight, top: rect.bottom + GAP },
      );
    }

    place();
    // Capture phase so scrolls inside the drawer body (and any ancestor) fire.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, results.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      const target = e.target as Node;
      // The list lives in a portal, so it's outside rootRef — check it too.
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    }
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [open]);

  // Reset the highlighted row whenever the query changes.
  useEffect(() => { setActive(0); }, [query]);

  function commit(opt: ProductPickerOption) {
    onChange(opt.id);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive(a => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); commit(results[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  // When closed, the input mirrors the selected product; when open, the query.
  const displayValue = open ? query : (selected ? labelFor(selected) : '');
  const listId = id ? `${id}-listbox` : undefined;

  return (
    <div className="product-picker" ref={rootRef}>
      <input
        id={id}
        ref={inputRef}
        className="product-picker__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={displayValue}
        placeholder={selected ? labelFor(selected) : placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={handleKeyDown}
      />

      {open && coords && createPortal(
        <ul
          className="product-picker__list"
          role="listbox"
          id={listId}
          ref={listRef}
          style={{
            position: 'fixed',
            zIndex: 1000,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
            ...(coords.top != null ? { top: coords.top } : { bottom: coords.bottom }),
          }}
        >
          {value && (
            <li
              className="product-picker__option product-picker__option--clear"
              role="option"
              aria-selected={false}
              onMouseDown={e => { e.preventDefault(); onChange(''); setQuery(''); setOpen(false); }}
            >
              {placeholder ?? '—'}
            </li>
          )}

          {results.length === 0 ? (
            <li className="product-picker__empty">{emptyLabel ?? '—'}</li>
          ) : (
            results.map((opt, i) => (
              <li
                key={opt.id}
                className={
                  'product-picker__option' +
                  (i === active ? ' product-picker__option--active' : '') +
                  (opt.id === value ? ' product-picker__option--selected' : '')
                }
                role="option"
                aria-selected={opt.id === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); commit(opt); }}
              >
                <span className="product-picker__option-label">
                  {labelFor(opt)}
                  {opt.type === 'kit' && kitLabel && (
                    <span className="product-picker__badge">{kitLabel}</span>
                  )}
                </span>
                {opt.description && (
                  <span className="product-picker__option-desc">{opt.description}</span>
                )}
              </li>
            ))
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}

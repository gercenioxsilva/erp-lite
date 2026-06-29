import { useEffect, useMemo, useRef, useState } from 'react';
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
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find(o => o.id === value) ?? null,
    [options, value],
  );
  const results = useMemo(() => filterProducts(options, query), [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
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

      {open && (
        <ul className="product-picker__list" role="listbox" id={listId}>
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
        </ul>
      )}
    </div>
  );
}

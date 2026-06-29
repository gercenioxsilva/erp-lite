import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ProductPicker, filterProducts, type ProductPickerOption } from '../ProductPicker';

/* ── Fixtures ───────────────────────────────────────────────────────────── */
const OPTIONS: ProductPickerOption[] = [
  { id: 'mat-1', sku: 'CAM001', name: 'Camiseta', description: 'Algodão penteado fio 30.1 gola careca' },
  { id: 'mat-2', sku: 'CAN002', name: 'Caneca',   description: 'Porcelana branca 325ml sublimável' },
  { id: 'mat-3', sku: 'BON003', name: 'Boné',     description: null },
];

/* ── filterProducts (pure helper) ───────────────────────────────────────── */
describe('filterProducts', () => {
  it('returns all options when query is empty', () => {
    expect(filterProducts(OPTIONS, '')).toHaveLength(3);
    expect(filterProducts(OPTIONS, '   ')).toHaveLength(3);
  });

  it('matches by name (case-insensitive)', () => {
    const r = filterProducts(OPTIONS, 'camise');
    expect(r.map(o => o.id)).toEqual(['mat-1']);
  });

  it('matches by sku', () => {
    const r = filterProducts(OPTIONS, 'can002');
    expect(r.map(o => o.id)).toEqual(['mat-2']);
  });

  it('matches by description — a variation only present in the description', () => {
    // "sublimável" only appears in the Caneca description, not its name/sku
    const r = filterProducts(OPTIONS, 'sublimavel');
    expect(r.map(o => o.id)).toEqual(['mat-2']);
  });

  it('is accent-insensitive so users find items without typing diacritics', () => {
    const r = filterProducts(OPTIONS, 'algodao');
    expect(r.map(o => o.id)).toEqual(['mat-1']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterProducts(OPTIONS, 'inexistente')).toHaveLength(0);
  });
});

/* ── ProductPicker (component) ──────────────────────────────────────────── */
describe('ProductPicker', () => {
  it('finds a product by a term that only exists in its description and selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ProductPicker options={OPTIONS} value="" onChange={onChange} ariaLabel="Produto" />,
    );

    const input = screen.getByRole('combobox', { name: 'Produto' });
    await user.click(input);
    await user.type(input, 'sublimavel');

    const listbox = screen.getByRole('listbox');
    const matches = within(listbox).getAllByRole('option');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveTextContent('Caneca');

    await user.click(matches[0]);
    expect(onChange).toHaveBeenCalledWith('mat-2');
  });

  it('shows the selected product label when a value is set', () => {
    render(
      <ProductPicker options={OPTIONS} value="mat-1" onChange={vi.fn()} ariaLabel="Produto" />,
    );
    const input = screen.getByRole('combobox', { name: 'Produto' }) as HTMLInputElement;
    expect(input.value).toContain('Camiseta');
    expect(input.value).toContain('CAM001');
  });

  it('shows an empty-state message when no product matches', async () => {
    const user = userEvent.setup();
    render(
      <ProductPicker
        options={OPTIONS}
        value=""
        onChange={vi.fn()}
        ariaLabel="Produto"
        emptyLabel="Nenhum produto encontrado"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Produto' });
    await user.click(input);
    await user.type(input, 'zzzzz');
    expect(screen.getByText('Nenhum produto encontrado')).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrdersPage } from '../OrdersPage';
import ptBR from '../../../i18n/pt-BR';

/* ── Translation helper (same behaviour as the real hook in pt-BR) ──────── */
const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

/* ── Module mocks ───────────────────────────────────────────────────────── */
// vi.mock factories are hoisted to the top of the file, so mock functions must
// also be hoisted via vi.hoisted to be available when the factory runs.
const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({
  mockGet:   vi.fn(),
  mockPost:  vi.fn(),
  mockPatch: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    // permissions precisa cobrir os botões gated por <Can> na página (Novo
    // pedido → orders:create; Editar/Confirmar → orders:edit) — em produção
    // um 'owner' real recebe todas as permissões do backend.
    user: { name: 'Test', role: 'owner', permissions: ['orders:view', 'orders:create', 'orders:edit'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    error:   vi.fn(),
    success: vi.fn(),
  }),
}));

/* ── Fixture data ───────────────────────────────────────────────────────── */
const EMPTY_ORDERS    = { data: [], total: 0, page: 1, per_page: 20  };
const EMPTY_CLIENTS   = { data: [], total: 0, page: 1, per_page: 100 };
const EMPTY_MATERIALS = { data: [], total: 0, page: 1, per_page: 100 };

const MOCK_CLIENTS = [
  { id: 'client-pj', company_name: 'ACME Ltda',  full_name: null         },
  { id: 'client-pf', company_name: null,          full_name: 'João Silva' },
];

const MOCK_MATERIALS = [
  { id: 'mat-1', sku: 'SKU001', name: 'Produto A', unit: 'UN', sale_price: 99.90 },
  { id: 'mat-2', sku: 'SRV001', name: 'Serviço B', unit: 'H',  sale_price: 150   },
];

const MOCK_ORDERS = [
  {
    id: 'order-1', number: '00001', status: 'draft', client_id: 'client-pj',
    client_name: 'ACME Ltda', subtotal: 199.80, discount: 0, shipping: 0, total: 199.80,
    notes: null, created_at: '2025-01-15T10:00:00Z',
  },
];

/* ── Setup helpers ──────────────────────────────────────────────────────── */
function setupEmptyMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/orders'))    return Promise.resolve(EMPTY_ORDERS);
    if (url.includes('/v1/clients'))   return Promise.resolve(EMPTY_CLIENTS);
    if (url.includes('/v1/materials')) return Promise.resolve(EMPTY_MATERIALS);
    return Promise.resolve({});
  });
}

function setupWithData() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/orders'))    return Promise.resolve({ data: MOCK_ORDERS, total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/clients'))   return Promise.resolve({ data: MOCK_CLIENTS,   total: 2, page: 1, per_page: 100 });
    if (url.includes('/v1/materials')) return Promise.resolve({ data: MOCK_MATERIALS, total: 2, page: 1, per_page: 100 });
    return Promise.resolve({});
  });
}

/* ── Tests ──────────────────────────────────────────────────────────────── */
describe('OrdersPage — list view', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders page title and "Novo Pedido" button', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    expect(screen.getByText(t('o.title'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /novo pedido/i })).toBeInTheDocument();
  });

  it('renders all status filter tabs', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    expect(screen.getByRole('button', { name: t('o.all') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('o.status.draft') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('o.status.confirmed') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('o.status.delivered') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('o.status.cancelled') })).toBeInTheDocument();
  });

  it('calls orders API with tenant_id on mount', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id=tenant-123'),
      );
    });
  });

  it('shows empty state when no orders exist', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    await waitFor(() => {
      expect(screen.getByText(t('o.empty'))).toBeInTheDocument();
    });
  });

  it('shows order rows when orders exist', async () => {
    setupWithData();
    render(<OrdersPage />);
    await waitFor(() => {
      expect(screen.getByText('#00001')).toBeInTheDocument();
      expect(screen.getByText('ACME Ltda')).toBeInTheDocument();
      // "Rascunho" appears in both the tab button and the status badge.
      // Scope to the table row to avoid ambiguity.
      const row = screen.getByText('ACME Ltda').closest('tr')!;
      expect(within(row).getByText(t('o.status.draft'))).toBeInTheDocument();
    });
  });

  it('shows Edit and Confirmar buttons for draft orders', async () => {
    setupWithData();
    render(<OrdersPage />);
    // Wait for the order row to appear first, then assert action buttons
    await waitFor(() => expect(screen.getByText('#00001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: t('c.edit') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('o.confirm') })).toBeInTheDocument();
  });

  it('filters orders by status tab', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    await waitFor(() => screen.getByText(t('o.empty')));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('o.status.confirmed') }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('status=confirmed'),
      );
    });
  });
});

describe('OrdersPage — drawer / create form', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens drawer when clicking "Novo Pedido"', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    expect(screen.getByRole('heading', { name: t('o.new') })).toBeInTheDocument();
  });

  it('closes drawer when clicking Cancelar', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    expect(screen.getByRole('heading', { name: t('o.new') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('c.cancel') }));
    expect(screen.queryByRole('heading', { name: t('o.new') })).not.toBeInTheDocument();
  });

  it('fetches clients and materials when drawer opens', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/clients?tenant_id=tenant-123'),
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/materials?tenant_id=tenant-123'),
      );
    });
  });

  it('requests per_page=100 for dropdown data (API cap is 100)', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('per_page=100'));
    });
  });

  it('populates client select with registered clients', async () => {
    setupWithData();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => {
      const select = screen.getByLabelText(`${t('o.client')} *`);
      expect(within(select as HTMLElement).getByRole('option', { name: 'ACME Ltda' })).toBeInTheDocument();
      expect(within(select as HTMLElement).getByRole('option', { name: 'João Silva' })).toBeInTheDocument();
    });
  });

  it('populates material picker with registered materials', async () => {
    setupWithData();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    const materialPickers = await screen.findAllByRole('combobox', { name: t('o.material') });
    expect(materialPickers.length).toBeGreaterThan(0);
    await user.click(materialPickers[0]);
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /SKU001.*Produto A/ })).toBeInTheDocument();
  });

  it('finds a product by a term that only exists in its description', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/orders'))    return Promise.resolve(EMPTY_ORDERS);
      if (url.includes('/v1/clients'))   return Promise.resolve({ data: MOCK_CLIENTS, total: 2, page: 1, per_page: 100 });
      if (url.includes('/v1/materials'))
        return Promise.resolve({
          data: [{ id: 'mat-9', sku: 'XYZ', name: 'Caneca', unit: 'UN', sale_price: 25, description: 'porcelana sublimável 325ml' }],
          total: 1, page: 1, per_page: 500,
        });
      return Promise.resolve({});
    });
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    const picker = (await screen.findAllByRole('combobox', { name: t('o.material') }))[0];
    await user.click(picker);
    await user.type(picker, 'sublimavel');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Caneca/ })).toBeInTheDocument();
  });

  it('shows error alert when client/material API fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/orders')) return Promise.resolve(EMPTY_ORDERS);
      return Promise.reject(new Error('Sem conexão com o servidor'));
    });
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor');
    });
  });

  it('shows validation error when submitting without a client', async () => {
    setupEmptyMocks();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => screen.getByRole('heading', { name: t('o.new') }));
    await user.click(screen.getByRole('button', { name: t('o.create') }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(t('o.errNoClient'));
    });
  });

  it('shows validation error when submitting with all blank item names', async () => {
    // Use setupWithData so clients load when the drawer opens (changing the mock
    // after the drawer is already open won't re-trigger the useEffect).
    setupWithData();
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));

    // Wait for clients to load into the select
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'ACME Ltda' })).toBeInTheDocument();
    });

    // Select a client so the "no client" validation passes
    await user.selectOptions(screen.getByLabelText(`${t('o.client')} *`), 'client-pj');

    // Leave item name empty (initial state) and submit
    await user.click(screen.getByRole('button', { name: t('o.create') }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(t('o.errNoItems'));
    });
  });
});

describe('OrdersPage — item management', () => {
  beforeEach(() => { vi.clearAllMocks(); setupEmptyMocks(); });

  async function openDrawer() {
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));
    await waitFor(() => screen.getByRole('heading', { name: t('o.new') }));
    return user;
  }

  it('starts with one item row', async () => {
    await openDrawer();
    expect(screen.getAllByTestId(/remove-item-/)).toHaveLength(1);
  });

  it('adds a new item row when clicking "+ Adicionar Item"', async () => {
    const user = await openDrawer();
    await user.click(screen.getByRole('button', { name: /adicionar item/i }));
    expect(screen.getAllByTestId(/remove-item-/)).toHaveLength(2);
  });

  it('removes an item row when clicking the × button', async () => {
    const user = await openDrawer();
    await user.click(screen.getByRole('button', { name: /adicionar item/i }));
    expect(screen.getAllByTestId(/remove-item-/)).toHaveLength(2);
    await user.click(screen.getByTestId('remove-item-0'));
    expect(screen.getAllByTestId(/remove-item-/)).toHaveLength(1);
  });

  it('auto-fills name and price when a material is selected', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/orders'))    return Promise.resolve(EMPTY_ORDERS);
      if (url.includes('/v1/clients'))   return Promise.resolve(EMPTY_CLIENTS);
      if (url.includes('/v1/materials')) return Promise.resolve({ data: MOCK_MATERIALS, total: 2, page: 1, per_page: 500 });
      return Promise.resolve({});
    });
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));

    const matPicker = (await screen.findAllByRole('combobox', { name: t('o.material') }))[0];
    await user.click(matPicker);
    const option = within(screen.getByRole('listbox')).getByRole('option', { name: /SKU001.*Produto A/ });
    await user.click(option);

    // After selecting material, the free-text name input should disappear
    expect(screen.queryByPlaceholderText(t('o.namePH'))).not.toBeInTheDocument();

    // Unit price input should now have the material's sale price
    const priceInputs = screen.getAllByRole('spinbutton', { name: t('o.unitPrice') });
    expect((priceInputs[0] as HTMLInputElement).value).toBe('99.9');
  });

  it('updates live total when quantity and price change', async () => {
    const user = await openDrawer();
    const qtyInputs   = screen.getAllByRole('spinbutton', { name: t('o.qty') });
    const priceInputs = screen.getAllByRole('spinbutton', { name: t('o.unitPrice') });

    await user.clear(qtyInputs[0] as HTMLElement);
    await user.type(qtyInputs[0] as HTMLElement, '3');
    await user.clear(priceInputs[0] as HTMLElement);
    await user.type(priceInputs[0] as HTMLElement, '10');

    // 3 × 10 = 30 — displayed as BRL
    await waitFor(() => {
      const totalEl = screen.getByTestId('total-value');
      expect(totalEl.textContent).toContain('30');
    });
  });
});

describe('OrdersPage — form submission', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls POST /v1/orders with correct payload and closes drawer', async () => {
    setupWithData();
    mockPost.mockResolvedValue({ id: 'order-new', number: '00002', status: 'draft', total: 99.90 });
    // After successful post, re-fetch returns empty list (order was just created)
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/orders'))    return Promise.resolve(EMPTY_ORDERS);
      if (url.includes('/v1/clients'))   return Promise.resolve({ data: MOCK_CLIENTS,   total: 2, page: 1, per_page: 100 });
      if (url.includes('/v1/materials')) return Promise.resolve({ data: MOCK_MATERIALS, total: 2, page: 1, per_page: 100 });
      return Promise.resolve({});
    });

    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));

    // Wait for clients to load
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'ACME Ltda' })).toBeInTheDocument();
    });

    // Select client
    await user.selectOptions(screen.getByLabelText(`${t('o.client')} *`), 'client-pj');

    // Type item name
    const nameInput = screen.getByPlaceholderText(t('o.namePH'));
    await user.clear(nameInput);
    await user.type(nameInput, 'Consultoria');

    // Submit
    await user.click(screen.getByRole('button', { name: t('o.create') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v1/orders', expect.objectContaining({
        tenant_id: 'tenant-123',
        client_id: 'client-pj',
        items: expect.arrayContaining([
          expect.objectContaining({ name: 'Consultoria' }),
        ]),
      }));
    });

    // Drawer should be closed after success
    expect(screen.queryByRole('heading', { name: t('o.new') })).not.toBeInTheDocument();
  });

  it('shows error alert when POST fails', async () => {
    setupWithData();
    mockPost.mockRejectedValue(new Error('Erro interno do servidor'));
    render(<OrdersPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /novo pedido/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'ACME Ltda' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(`${t('o.client')} *`), 'client-pj');
    const nameInput = screen.getByPlaceholderText(t('o.namePH'));
    await user.type(nameInput, 'Item X');
    await user.click(screen.getByRole('button', { name: t('o.create') }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Erro interno do servidor');
    });
    // Drawer stays open on error
    expect(screen.getByRole('heading', { name: t('o.new') })).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InvoiceNewPage } from '../InvoiceNewPage';
import ptBR from '../../../i18n/pt-BR';

// Cobre a regra 61: herança de vendedor/centro de custo/NCM/CFOP a partir do
// pedido de origem, trava de NCM/CFOP no cadastro do produto (nunca editável
// na tela de nota) e o aviso + link pro cadastro quando o produto não tem
// código fiscal cadastrado.

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPost, mockNavigate } = vi.hoisted(() => ({
  mockGet:      vi.fn(),
  mockPost:     vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ tenantId: 'tenant-123', user: { name: 'Test', role: 'owner', permissions: ['invoices:create'] } }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const CLIENT_ID = 'client-1';
const ORDER_ID  = 'order-1';
const SELLER_ID = 'seller-1';
const CC_ID     = 'cc-1';

const MAT_WITH_FISCAL = {
  id: 'mat-with-fiscal', sku: 'SKU001', name: 'Produto Com Fiscal',
  ncm_code: '1234.56.78', cfop: '5102', sale_price: 50,
};
const MAT_WITHOUT_FISCAL = {
  id: 'mat-without-fiscal', sku: 'SKU002', name: 'Produto Sem Fiscal',
  ncm_code: null, cfop: null, sale_price: 30,
};

const ORDER_DETAIL = {
  client_id: CLIENT_ID, seller_id: SELLER_ID, cost_center_id: CC_ID,
  items: [{
    material_id: MAT_WITH_FISCAL.id, name: MAT_WITH_FISCAL.name, quantity: 2, unit_price: 50,
    ncm_code: MAT_WITH_FISCAL.ncm_code, cfop: MAT_WITH_FISCAL.cfop,
  }],
};

function setupMocks(overrides: { orderDetail?: unknown } = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/clients'))
      return Promise.resolve({ data: [{ id: CLIENT_ID, company_name: 'ACME Ltda', full_name: null }] });
    if (url.includes('/v1/materials/') && url.includes('/components'))
      return Promise.resolve({ data: [] });
    if (url.includes('/v1/materials'))
      return Promise.resolve({ data: [MAT_WITH_FISCAL, MAT_WITHOUT_FISCAL] });
    if (url.includes('/v1/orders/') && url.match(/\/v1\/orders\/[\w-]+$/))
      return Promise.resolve(overrides.orderDetail ?? ORDER_DETAIL);
    if (url.includes('/v1/orders'))
      return Promise.resolve({ data: [{ id: ORDER_ID, number: '00001', client_id: CLIENT_ID, client_name: 'ACME Ltda', status: 'draft' }] });
    if (url.includes('/v1/nfe-config')) return Promise.resolve({ focus_ambiente: null });
    if (url.includes('/v1/cost-centers/active'))
      return Promise.resolve({ data: [{ id: CC_ID, code: '001', name: 'Centro X' }] });
    if (url.includes('/v1/cost-centers/') && url.includes('/stock'))
      return Promise.resolve({ data: [] });
    if (url.includes('/v1/sellers/active'))
      return Promise.resolve([{ id: SELLER_ID, name: 'Vendedor X' }]);
    if (url.includes('/v1/companies')) return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InvoiceNewPage />
    </MemoryRouter>,
  );
}

describe('InvoiceNewPage — herança de dados do pedido (regra 61)', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  async function linkOrder() {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /00001/ })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByLabelText(t('inv.fromOrder')), ORDER_ID);
    return user;
  }

  it('herda o vendedor do pedido vinculado', async () => {
    await linkOrder();
    await waitFor(() => {
      expect((screen.getByLabelText(t('sel.seller')) as HTMLSelectElement).value).toBe(SELLER_ID);
    });
  });

  it('herda o centro de custo do pedido vinculado', async () => {
    await linkOrder();
    await waitFor(() => {
      expect((screen.getByLabelText(t('cc.costCenter')) as HTMLSelectElement).value).toBe(CC_ID);
    });
  });

  it('herda NCM/CFOP do cadastro do produto ao vincular o pedido', async () => {
    await linkOrder();
    await waitFor(() => {
      expect(screen.getByText('1234.56.78')).toBeInTheDocument();
      expect(screen.getByText('5102')).toBeInTheDocument();
    });
  });

  it('[regressão] NCM/CFOP vêm da resposta do pedido, não de recasar contra a lista de materiais da tela (regra 62)', async () => {
    // GET /v1/materials devolve uma lista vazia (simula: catálogo grande
    // além do per_page=500, ou dado desatualizado em memória) -- mesmo assim
    // o pedido já traz ncm_code/cfop prontos via JOIN no backend, então a
    // herança não pode depender de materials.find() encontrar o produto.
    setupMocks({});
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/clients'))
        return Promise.resolve({ data: [{ id: CLIENT_ID, company_name: 'ACME Ltda', full_name: null }] });
      if (url.includes('/v1/materials/') && url.includes('/components')) return Promise.resolve({ data: [] });
      if (url.includes('/v1/materials')) return Promise.resolve({ data: [] });
      if (url.includes('/v1/orders/') && url.match(/\/v1\/orders\/[\w-]+$/)) return Promise.resolve(ORDER_DETAIL);
      if (url.includes('/v1/orders'))
        return Promise.resolve({ data: [{ id: ORDER_ID, number: '00001', client_id: CLIENT_ID, client_name: 'ACME Ltda', status: 'draft' }] });
      if (url.includes('/v1/nfe-config')) return Promise.resolve({ focus_ambiente: null });
      if (url.includes('/v1/cost-centers/active')) return Promise.resolve({ data: [{ id: CC_ID, code: '001', name: 'Centro X' }] });
      if (url.includes('/v1/cost-centers/') && url.includes('/stock')) return Promise.resolve({ data: [] });
      if (url.includes('/v1/sellers/active')) return Promise.resolve([{ id: SELLER_ID, name: 'Vendedor X' }]);
      if (url.includes('/v1/companies')) return Promise.resolve({ data: [] });
      return Promise.resolve({});
    });
    await linkOrder();
    await waitFor(() => {
      expect(screen.getByText('1234.56.78')).toBeInTheDocument();
      expect(screen.getByText('5102')).toBeInTheDocument();
    });
  });

  it('pedido sem vendedor/centro de custo: campos ficam vazios, sem quebrar a tela', async () => {
    setupMocks({ orderDetail: { client_id: CLIENT_ID, seller_id: null, cost_center_id: null, items: [] } });
    await linkOrder();
    await waitFor(() => {
      expect((screen.getByLabelText(t('sel.seller')) as HTMLSelectElement).value).toBe('');
      expect((screen.getByLabelText(t('cc.costCenter')) as HTMLSelectElement).value).toBe('');
    });
  });
});

describe('InvoiceNewPage — NCM/CFOP travados no cadastro do produto', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  // Passo 3 (Itens) só desbloqueia depois de um cliente selecionado (Passo 2).
  async function selectClientAndGetUser() {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole('option', { name: 'ACME Ltda' }));
    await user.selectOptions(screen.getByLabelText(`${t('inv.client')} *`), CLIENT_ID);
    await waitFor(() => screen.getByText(t('o.items')));
    return user;
  }

  it('não existe nenhum input de texto livre para NCM/CFOP na tabela de itens', async () => {
    await selectClientAndGetUser();
    expect(screen.queryByLabelText(t('inv.ncm'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t('inv.cfop'))).not.toBeInTheDocument();
  });

  it('produto sem NCM/CFOP cadastrado mostra aviso com link pro cadastro do produto', async () => {
    const user = await selectClientAndGetUser();

    const picker = (await screen.findAllByRole('combobox', { name: t('o.material') }))[0];
    await user.click(picker);
    const listbox = screen.getByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: /SKU002.*Produto Sem Fiscal/ }));

    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /cadastrar/i });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute('href', expect.stringContaining(`/materials?edit=${MAT_WITHOUT_FISCAL.id}`));
    });
  });

  it('item sem produto selecionado mostra orientação para cadastrar/selecionar um produto, não um input livre', async () => {
    await selectClientAndGetUser();
    expect(screen.getByText(t('inv.itemNeedsProduct'))).toBeInTheDocument();
  });
});

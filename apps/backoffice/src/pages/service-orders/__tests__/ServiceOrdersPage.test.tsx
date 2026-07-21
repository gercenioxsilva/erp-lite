import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceOrdersPage } from '../ServiceOrdersPage';
import ptBR from '../../../i18n/pt-BR';

// Cobre o bug relatado: depois de criada, uma OS não podia ser editada (nem
// backend nem frontend tinham o caminho). Editável só em 'draft'
// (assertServiceOrderEditable, mesmo princípio de Pedido de Compra).

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

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
    user: { name: 'Test', role: 'owner', permissions: ['service_orders:view', 'service_orders:create', 'service_orders:edit', 'service_orders:assign'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const EMPTY_LIST = { data: [], total: 0, page: 1, per_page: 20 };
const CLIENTS = { data: [{ id: 'client-1', company_name: 'ACME Ltda', full_name: null }] };
const MATERIALS = { data: [{ id: 'mat-1', sku: 'SKU1', name: 'Produto A', unit: 'UN', sale_price: 10 }] };

function mockResponses(technicians: 'ok' | 'fail'): void {
  mockGet.mockImplementation((path: string) => {
    if (path.startsWith('/v1/service-orders')) return Promise.resolve(EMPTY_LIST);
    if (path.startsWith('/v1/clients')) return Promise.resolve(CLIENTS);
    if (path.startsWith('/v1/technicians')) {
      return technicians === 'ok' ? Promise.resolve({ data: [] }) : Promise.reject(new Error('403 Forbidden'));
    }
    if (path.startsWith('/v1/materials')) return Promise.resolve(MATERIALS);
    if (path.startsWith('/v1/companies')) return Promise.resolve({ data: [] });
    return Promise.resolve(EMPTY_LIST);
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('ServiceOrdersPage — modal Nova OS', () => {
  it('carrega clientes e materiais mesmo quando a lista de técnicos falha (403)', async () => {
    mockResponses('fail');
    const user = userEvent.setup();
    render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);

    await user.click(await screen.findByText(`+ ${t('so.new')}`));

    const clientSelect = await screen.findByLabelText(t('so.client'));
    await waitFor(() => {
      expect(clientSelect).toHaveTextContent('ACME Ltda');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

const SO_ID = 'so-1';

const DRAFT_ORDER = {
  id: SO_ID, number: '00001', title: 'Manutenção preventiva', type: 'maintenance', status: 'draft',
  total: 150, created_at: '2026-01-01T00:00:00Z', client_name: 'ACME Ltda',
};

const DRAFT_DETAIL = {
  ...DRAFT_ORDER, description: 'Trocar filtro de ar', client_id: 'client-1',
  items: [{ id: 'item-1', material_id: null, description: 'Troca de filtro', quantity: 1, unit_price: 150, total: 150 }],
  visits: [], receivable_id: null, receivable_status: null, receivable_due_date: null,
  receivable_amount: null, receivable_paid_amount: null, boleto_status: null, brcode: null,
  pix_qr_code: null, boleto_url: null, nfse_id: null, nfse_status: null,
};

const SCHEDULED_DETAIL = { ...DRAFT_DETAIL, status: 'scheduled' };

const VISIT_ID = 'visit-1';
const COMPLETED_DETAIL = {
  ...DRAFT_DETAIL, status: 'completed',
  visits: [{
    id: VISIT_ID, status: 'completed', scheduled_at: '2026-01-05T13:00:00Z',
    checked_in_at: '2026-01-05T13:05:00Z', checked_out_at: '2026-01-05T14:00:00Z',
    technician_name: 'Técnico X', technician_current_name: 'Técnico X',
    report_notes: 'Filtro trocado com sucesso', signed_by_name: 'Cliente Y', signed_at: '2026-01-05T14:00:00Z',
    visit_link: null, link_valid: false,
  }],
};
const VISIT_DETAIL = {
  ...COMPLETED_DETAIL.visits[0],
  photos: [{ id: 'photo-1', caption: 'Antes da troca', created_at: '2026-01-05T13:10:00Z', url: 'https://s3.example.com/photo-1.jpg?sig=abc' }],
  signature_url: 'https://s3.example.com/signature.png?sig=xyz',
};

function setupMocks(detail: unknown = DRAFT_DETAIL) {
  mockGet.mockImplementation((url: string) => {
    if (url.match(/\/v1\/service-orders\/[\w-]+$/)) return Promise.resolve(detail);
    if (url.includes('/v1/service-orders')) return Promise.resolve({ data: [DRAFT_ORDER], total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/clients'))      return Promise.resolve({ data: [{ id: 'client-1', company_name: 'ACME Ltda', full_name: null }] });
    if (url.includes('/v1/technicians'))  return Promise.resolve({ data: [] });
    if (url.includes('/v1/materials'))    return Promise.resolve({ data: [] });
    if (url.includes('/v1/companies'))    return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);
}

describe('ServiceOrdersPage — edição de OS (regra: editável só em draft)', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  it('OS em draft mostra o botão Editar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByRole('button', { name: t('so.edit') }));
  });

  it('OS agendada (scheduled) NÃO mostra o botão Editar', async () => {
    setupMocks(SCHEDULED_DETAIL);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByText('Trocar filtro de ar'));
    expect(screen.queryByRole('button', { name: t('so.edit') })).not.toBeInTheDocument();
  });

  it('clicar em Editar pré-preenche o formulário e salva via PATCH /v1/service-orders/:id', async () => {
    mockPatch.mockResolvedValue({ id: SO_ID, status: 'draft' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByRole('button', { name: t('so.edit') }));
    await user.click(screen.getByRole('button', { name: t('so.edit') }));

    await waitFor(() => {
      expect((screen.getByLabelText(`${t('so.osTitle')} *`) as HTMLInputElement).value).toBe('Manutenção preventiva');
    });

    const titleInput = screen.getByLabelText(`${t('so.osTitle')} *`) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Manutenção corretiva');

    await user.click(screen.getByRole('button', { name: t('so.save') }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(`/v1/service-orders/${SO_ID}`, expect.objectContaining({
        title: 'Manutenção corretiva',
        type: 'maintenance',
      }));
    });
  });
});

describe('ServiceOrdersPage — visualização de fotos da visita', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(COMPLETED_DETAIL); });

  it('visita sem check-in não mostra o botão Ver Fotos', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByText('Técnico X'));
    expect(screen.queryByRole('button', { name: /Ver Fotos/ })).toBeInTheDocument();
  });

  it('abre o modal e mostra as fotos + assinatura da visita já com check-in', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === `/v1/service-orders/${SO_ID}/visits/${VISIT_ID}`) return Promise.resolve(VISIT_DETAIL);
      if (url.match(/\/v1\/service-orders\/[\w-]+$/)) return Promise.resolve(COMPLETED_DETAIL);
      if (url.includes('/v1/service-orders')) return Promise.resolve({ data: [DRAFT_ORDER], total: 1, page: 1, per_page: 20 });
      if (url.includes('/v1/clients'))     return Promise.resolve({ data: [] });
      if (url.includes('/v1/technicians')) return Promise.resolve({ data: [] });
      if (url.includes('/v1/materials'))   return Promise.resolve({ data: [] });
      if (url.includes('/v1/companies'))   return Promise.resolve({ data: [] });
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByText('Técnico X'));

    await user.click(screen.getByRole('button', { name: /Ver Fotos/ }));

    await waitFor(() => {
      expect(screen.getByText('Antes da troca')).toBeInTheDocument();
      expect(screen.getByAltText(t('so.clientSignature'))).toBeInTheDocument();
    });
    // "Cliente Y" também aparece no card da visita (por trás do modal, via
    // "Assinado por Cliente Y") — usar getAllByText pra não colidir com isso.
    expect(screen.getAllByText(/Cliente Y/).length).toBeGreaterThanOrEqual(1);
  });
});

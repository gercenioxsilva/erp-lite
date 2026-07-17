import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectsPage } from '../ProjectsPage';
import ptBR from '../../../i18n/pt-BR';

// Cobre o CRUD do módulo de Projetos: edição só em draft (mesmo padrão de
// ServiceOrdersPage), alocação de profissional (comissão informativa) e
// vínculo de pedido — sem tocar PATCH /orders/:id.

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPost, mockPatch, mockDelete } = vi.hoisted(() => ({
  mockGet:    vi.fn(),
  mockPost:   vi.fn(),
  mockPatch:  vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, delete: mockDelete },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: { name: 'Test', role: 'owner', permissions: ['projects:view', 'projects:create', 'projects:edit'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const PROJECT_ID = 'proj-1';

const DRAFT_PROJECT = {
  id: PROJECT_ID, number: '00001', name: 'Reforma Loja A', total_value: 15000, status: 'draft',
  created_at: '2026-01-01T00:00:00Z', client_name: 'ACME Ltda', consumed_value: 0,
};

const REPORT = { goodsServicesConsumed: 0, goodsServicesInvoiced: 0, budgetConsumedPct: 0, budgetInvoicedPct: 0 };

const DRAFT_DETAIL = {
  ...DRAFT_PROJECT, description: 'Loja nova', client_id: 'client-1', cost_center_id: null,
  start_date: null, end_date: null,
  professionals: [], orders: [], service_orders: [], report: REPORT,
};

const IN_PROGRESS_DETAIL = { ...DRAFT_DETAIL, status: 'in_progress' };

function setupMocks(detail: unknown = DRAFT_DETAIL) {
  mockGet.mockImplementation((url: string) => {
    if (url.match(/\/v1\/projects\/[\w-]+$/)) return Promise.resolve(detail);
    if (url.includes('/v1/projects')) return Promise.resolve({ data: [DRAFT_PROJECT], total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/clients'))      return Promise.resolve({ data: [{ id: 'client-1', company_name: 'ACME Ltda', full_name: null }] });
    if (url.includes('/v1/cost-centers/active')) return Promise.resolve({ data: [] });
    if (url.includes('/v1/technicians'))  return Promise.resolve({ data: [{ id: 'tech-1', name: 'Técnico X', is_active: true }] });
    if (url.includes('/v1/sellers/active')) return Promise.resolve([{ id: 'seller-1', name: 'Vendedor Y' }]);
    if (url.includes('/v1/orders'))       return Promise.resolve({ data: [{ id: 'order-1', number: '00010', status: 'confirmed', client_name: 'ACME Ltda' }] });
    if (url.includes('/v1/service-orders')) return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

function renderPage() { return render(<ProjectsPage />); }

describe('ProjectsPage — edição só em draft', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  it('projeto em draft mostra o botão Editar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByRole('button', { name: t('proj.edit') }));
  });

  it('projeto em andamento NÃO mostra o botão Editar, mostra Concluir/Cancelar', async () => {
    setupMocks(IN_PROGRESS_DETAIL);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByRole('button', { name: t('proj.complete') }));
    expect(screen.queryByRole('button', { name: t('proj.edit') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('proj.cancel') })).toBeInTheDocument();
  });

  it('editar salva via PATCH /v1/projects/:id', async () => {
    mockPatch.mockResolvedValue({ id: PROJECT_ID });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByRole('button', { name: t('proj.edit') }));
    await user.click(screen.getByRole('button', { name: t('proj.edit') }));

    await waitFor(() => {
      expect((screen.getByLabelText(`${t('proj.name')} *`) as HTMLInputElement).value).toBe('Reforma Loja A');
    });

    await user.click(screen.getByRole('button', { name: t('proj.save') }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(`/v1/projects/${PROJECT_ID}`, expect.objectContaining({ name: 'Reforma Loja A' }));
    });
  });
});

describe('ProjectsPage — alocação de profissional e vínculo de pedido', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  it('aloca um técnico com % de comissão informativo via POST /v1/projects/:id/professionals', async () => {
    mockPost.mockResolvedValue({ id: 'alloc-1' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByText(t('proj.professionals.title')));

    await user.selectOptions(screen.getByLabelText(t('proj.professionals.name')), 'tech-1');
    await user.click(screen.getByRole('button', { name: t('proj.professionals.add') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(`/v1/projects/${PROJECT_ID}/professionals`, expect.objectContaining({
        professional_type: 'technician', technician_id: 'tech-1',
      }));
    });
  });

  it('vincula um pedido existente via POST /v1/projects/:id/orders', async () => {
    mockPost.mockResolvedValue({ id: 'order-1' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('#00001'));
    await user.click(screen.getByText('#00001'));
    await waitFor(() => screen.getByText(t('proj.orders.title')));

    await user.selectOptions(screen.getByLabelText(t('proj.orders.title')), 'order-1');
    await user.click(screen.getAllByRole('button', { name: t('proj.orders.link') })[0]);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(`/v1/projects/${PROJECT_ID}/orders`, { order_id: 'order-1' });
    });
  });
});

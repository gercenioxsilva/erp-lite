import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceOrdersPage } from '../ServiceOrdersPage';
import ptBR from '../../../i18n/pt-BR';

// Campos Personalizados de Visita Técnica migraram de "Minha Empresa" pro
// próprio módulo de Ordens de Serviço (mesmo padrão de Contratos —
// ContractsPage.tsx::FieldDefinitionsModal). Cobre: botão só aparece pra
// quem tem service_visit_fields:view, e o CRUD dentro do modal funciona.

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPost, mockDelete, permissions } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockDelete: vi.fn(),
  permissions: { current: [] as string[] },
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), delete: mockDelete },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: { name: 'Test', role: 'owner', permissions: permissions.current },
  }),
}));

vi.mock('../../../i18n', () => ({ useI18n: () => ({ t, lang: 'pt-BR' }) }));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(true), error: vi.fn(), success: vi.fn() }),
}));

const EMPTY_LIST = { data: [], total: 0, page: 1, per_page: 20 };
const FIELD_DEFS = { data: [{ id: 'fd-1', field_key: 'tem_internet', label: 'Tem internet no local?', field_type: 'boolean', required: true, sort_order: 0 }] };

function mockResponses() {
  mockGet.mockImplementation((path: string) => {
    if (path.startsWith('/v1/service-orders')) return Promise.resolve(EMPTY_LIST);
    if (path === '/v1/service-visit-fields') return Promise.resolve(FIELD_DEFS);
    return Promise.resolve(EMPTY_LIST);
  });
}

beforeEach(() => { vi.clearAllMocks(); mockResponses(); });

describe('ServiceOrdersPage — Campos Personalizados de Visita', () => {
  it('não mostra o botão pra quem não tem service_visit_fields:view', async () => {
    permissions.current = ['service_orders:view', 'service_orders:create'];
    render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);

    await screen.findByText('Nova OS', { exact: false });
    expect(screen.queryByText('Campos Personalizados da Visita', { exact: false })).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/v1/service-visit-fields');
  });

  it('mostra o botão e lista os campos já cadastrados pra quem tem service_visit_fields:view', async () => {
    permissions.current = ['service_orders:view', 'service_orders:create', 'service_visit_fields:view', 'service_visit_fields:manage'];
    const user = userEvent.setup();
    render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);

    const button = await screen.findByText('Campos Personalizados da Visita', { exact: false });
    await user.click(button);

    const matches = await screen.findAllByText(/Tem internet no local/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('cria um novo campo personalizado via POST /v1/service-visit-fields', async () => {
    permissions.current = ['service_orders:view', 'service_orders:create', 'service_visit_fields:view', 'service_visit_fields:manage'];
    mockPost.mockResolvedValue({ id: 'fd-2' });
    const user = userEvent.setup();
    render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);

    await user.click(await screen.findByText('Campos Personalizados da Visita', { exact: false }));
    await screen.findAllByText(/Tem internet no local/);

    await user.type(screen.getByPlaceholderText('Ex.: Tem internet no local?'), 'Número do medidor');
    await user.click(screen.getByRole('button', { name: 'Adicionar campo' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/v1/service-visit-fields', expect.objectContaining({ label: 'Número do medidor' })));
  });

  it('remove um campo via DELETE /v1/service-visit-fields/:id', async () => {
    permissions.current = ['service_orders:view', 'service_orders:create', 'service_visit_fields:view', 'service_visit_fields:manage'];
    mockDelete.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MemoryRouter><ServiceOrdersPage /></MemoryRouter>);

    await user.click(await screen.findByText('Campos Personalizados da Visita', { exact: false }));
    await screen.findAllByText(/Tem internet no local/);

    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/v1/service-visit-fields/fd-1'));
  });
});

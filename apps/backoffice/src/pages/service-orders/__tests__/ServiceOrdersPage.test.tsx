import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceOrdersPage } from '../ServiceOrdersPage';
import ptBR from '../../../i18n/pt-BR';

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: {
      name: 'Test', role: 'user',
      permissions: ['service_orders:view', 'service_orders:create', 'service_orders:edit', 'service_orders:assign'],
    },
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

beforeEach(() => { mockGet.mockReset(); });

describe('ServiceOrdersPage — modal Nova OS', () => {
  it('carrega clientes e materiais mesmo quando a lista de técnicos falha (403)', async () => {
    mockResponses('fail');
    const user = userEvent.setup();
    render(<ServiceOrdersPage />);

    await user.click(await screen.findByText(`+ ${t('so.new')}`));

    const clientSelect = await screen.findByLabelText(t('so.client'));
    await waitFor(() => {
      expect(clientSelect).toHaveTextContent('ACME Ltda');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

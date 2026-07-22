import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayablesPage } from '../PayablesPage';
import ptBR from '../../../i18n/pt-BR';

// Alterar vencimento (regra 82) — mesma trava de ReceivablesPage, sem o
// caso de boleto (payables não têm integração bancária).

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPost, mockPatch } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: { name: 'Test', role: 'owner', permissions: ['payables:view', 'payables:create', 'payables:edit'] },
  }),
}));

vi.mock('../../../i18n', () => ({ useI18n: () => ({ t, lang: 'pt-BR' }) }));

const LIST_ROW = {
  id: 'pay-1', description: 'Aluguel — Jun/2026', supplier_id: null, supplier_name: 'Imobiliária X',
  category: 'rent', document_number: null, amount: '2000.00', paid_amount: '0.00',
  due_date: '2026-06-10', status: 'pending', notes: null, created_at: '2026-06-01T00:00:00Z',
};

function mockResponses(detailOverrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/payables/pay-1')) {
      return Promise.resolve({ ...LIST_ROW, ...detailOverrides, payments: [] });
    }
    if (url.includes('/v1/payables'))     return Promise.resolve({ data: [LIST_ROW], total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/cost-centers')) return Promise.resolve({ data: [] });
    if (url.includes('/v1/suppliers'))    return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

describe('PayablesPage — alterar vencimento (regra 82)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mostra o botão "Alterar vencimento" pra uma conta pendente', async () => {
    mockResponses();
    const user = userEvent.setup();
    render(<PayablesPage />);
    await waitFor(() => screen.getByText('Aluguel — Jun/2026'));
    await user.click(screen.getByText(t('pay.details')));

    await waitFor(() => {
      expect(screen.getByText(t('pay.changeDueDate'))).toBeInTheDocument();
    });
  });

  it('não mostra o botão quando a conta já está paga', async () => {
    mockResponses({ status: 'paid' });
    const user = userEvent.setup();
    render(<PayablesPage />);
    await waitFor(() => screen.getByText('Aluguel — Jun/2026'));
    await user.click(screen.getByText(t('pay.details')));

    await waitFor(() => expect(screen.getAllByText(t('pay.status.paid')).length).toBeGreaterThan(0));
    expect(screen.queryByText(t('pay.changeDueDate'))).not.toBeInTheDocument();
  });

  it('clicar em "Alterar vencimento", escolher uma data e salvar chama PATCH com due_date', async () => {
    mockResponses();
    mockPatch.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PayablesPage />);
    await waitFor(() => screen.getByText('Aluguel — Jun/2026'));
    await user.click(screen.getByText(t('pay.details')));
    await waitFor(() => screen.getByText(t('pay.changeDueDate')));

    await user.click(screen.getByText(t('pay.changeDueDate')));
    const dateInput = screen.getByLabelText(t('pay.newDueDate')) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2026-09-10');
    await user.click(screen.getByRole('button', { name: t('c.save') }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/payables/pay-1', { due_date: '2026-09-10' });
    });
  });
});

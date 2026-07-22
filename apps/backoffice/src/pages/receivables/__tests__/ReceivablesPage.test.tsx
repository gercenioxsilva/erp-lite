import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReceivablesPage } from '../ReceivablesPage';
import ptBR from '../../../i18n/pt-BR';

// Alterar vencimento (regra 82) — botão só aparece quando a conta ainda
// admite mudança de data (nem paga, nem cancelada, sem boleto emitido);
// clicar revela o input de data e salvar chama o PATCH existente.

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
    user: { name: 'Test', role: 'owner', permissions: ['receivables:view', 'receivables:create', 'receivables:edit'] },
  }),
}));

vi.mock('../../../i18n', () => ({ useI18n: () => ({ t, lang: 'pt-BR' }) }));

const LIST_ROW = {
  id: 'rec-1', description: 'Manutenção — Jun/2026', amount: '140.00', paid_amount: '40.00',
  due_date: '2026-06-27', status: 'partial', client_id: null, client_name: 'ACME Ltda',
  invoice_id: null, notes: null, created_at: '2026-06-01T00:00:00Z', boleto_id: null,
};

function mockResponses(detailOverrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/receivables/rec-1')) {
      return Promise.resolve({ ...LIST_ROW, ...detailOverrides, payments: [] });
    }
    if (url.includes('/v1/receivables')) return Promise.resolve({ data: [LIST_ROW], total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/clients'))      return Promise.resolve({ data: [] });
    if (url.includes('/v1/cost-centers')) return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

describe('ReceivablesPage — alterar vencimento (regra 82)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mostra o botão "Alterar vencimento" pra uma conta parcial sem boleto', async () => {
    mockResponses();
    const user = userEvent.setup();
    render(<ReceivablesPage />);
    await waitFor(() => screen.getByText('Manutenção — Jun/2026'));
    await user.click(screen.getByText(t('rec.details')));

    await waitFor(() => {
      expect(screen.getByText(t('rec.changeDueDate'))).toBeInTheDocument();
    });
  });

  it('não mostra o botão quando já existe boleto emitido — mostra o aviso em vez disso', async () => {
    mockResponses({ boleto_id: 'boleto-1' });
    const user = userEvent.setup();
    render(<ReceivablesPage />);
    await waitFor(() => screen.getByText('Manutenção — Jun/2026'));
    await user.click(screen.getByText(t('rec.details')));

    await waitFor(() => {
      expect(screen.getByText(t('rec.dueDateLockedBoleto'))).toBeInTheDocument();
    });
    expect(screen.queryByText(t('rec.changeDueDate'))).not.toBeInTheDocument();
  });

  it('não mostra o botão quando a conta já está paga', async () => {
    mockResponses({ status: 'paid' });
    const user = userEvent.setup();
    render(<ReceivablesPage />);
    await waitFor(() => screen.getByText('Manutenção — Jun/2026'));
    await user.click(screen.getByText(t('rec.details')));

    await waitFor(() => expect(screen.getAllByText(t('rec.status.paid')).length).toBeGreaterThan(0));
    expect(screen.queryByText(t('rec.changeDueDate'))).not.toBeInTheDocument();
  });

  it('clicar em "Alterar vencimento", escolher uma data e salvar chama PATCH com due_date', async () => {
    mockResponses();
    mockPatch.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ReceivablesPage />);
    await waitFor(() => screen.getByText('Manutenção — Jun/2026'));
    await user.click(screen.getByText(t('rec.details')));
    await waitFor(() => screen.getByText(t('rec.changeDueDate')));

    await user.click(screen.getByText(t('rec.changeDueDate')));
    const dateInput = screen.getByLabelText(t('rec.newDueDate')) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2026-08-15');
    await user.click(screen.getByRole('button', { name: t('c.save') }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/receivables/rec-1', { due_date: '2026-08-15' });
    });
  });
});

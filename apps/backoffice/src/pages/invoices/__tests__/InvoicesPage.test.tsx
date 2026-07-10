import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InvoicesPage } from '../InvoicesPage';
import ptBR from '../../../i18n/pt-BR';

// Cobre a regra 61: só existe UM caminho de emissão na lista de notas — o
// botão de linha que abre o painel de NF-e, dentro do qual "Enviar para
// SEFAZ" é o único botão que efetivamente emite. O antigo botão de linha
// "Emitir NF-e" (POST /invoices/:id/issue, nunca falava com o SEFAZ) foi
// removido junto com a rota.

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet:  vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: { name: 'Test', role: 'owner', permissions: ['invoices:view', 'invoices:create', 'invoices:cancel', 'invoices:emit'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const MOCK_INVOICES = [
  {
    id: 'inv-1', number: '00001', serie: '1', status: 'draft',
    client_name: 'ACME Ltda', order_id: null, order_number: null,
    subtotal: 100, tax_total: 0, total: 100, notes: null,
    issue_date: null, created_at: '2026-01-01T10:00:00Z',
    nfe_status: null, nfe_chave: null, nfe_reject_reason: null,
  },
];

function setupMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/invoices'))    return Promise.resolve({ data: MOCK_INVOICES, total: 1, page: 1, per_page: 20 });
    if (url.includes('/v1/clients'))     return Promise.resolve({ data: [] });
    if (url.includes('/v1/nfe-config'))  return Promise.resolve({ focus_ambiente: null });
    if (url.includes('/v1/cost-centers/active')) return Promise.resolve({ data: [] });
    if (url.includes('/nfe-events'))     return Promise.resolve([]);
    if (url.includes('/nfe'))            return Promise.resolve({ nfe_status: null, nfe_chave: null, nfe_protocol: null, nfe_auth_date: null, nfe_reject_reason: null, nfe_attempts: 0, nfe_danfe_url: null });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InvoicesPage />
    </MemoryRouter>,
  );
}

describe('InvoicesPage — botão único de emissão (regra 61)', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  it('a rota antiga /issue não existe mais como opção — só existe "NF-e" (abre painel)', async () => {
    renderPage();
    await waitFor(() => screen.getByText('ACME Ltda'));
    const row = screen.getByText('ACME Ltda').closest('tr')!;
    // Único botão de ação de emissão na linha: abre o painel real de NF-e.
    expect(within(row).getByRole('button', { name: t('nfe.viewPanel') })).toBeInTheDocument();
    // A chave i18n do botão legado não existe mais no dicionário.
    expect((ptBR as Record<string, string>)['inv.issue']).toBeUndefined();
    expect((ptBR as Record<string, string>)['inv.issueMsg']).toBeUndefined();
  });

  it('clicar no botão da linha abre o painel de NF-e com "Enviar para SEFAZ" como único caminho de emissão real', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('ACME Ltda'));
    const row = screen.getByText('ACME Ltda').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: t('nfe.viewPanel') }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t('nfe.emitSefaz') })).toBeInTheDocument();
    });
    // POST /v1/invoices/:id/issue nunca é chamado em lugar nenhum deste fluxo.
    expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining('/issue'), expect.anything());
  });

  it('"Enviar para SEFAZ" chama POST /emit (caminho real), nunca /issue', async () => {
    mockPost.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('ACME Ltda'));
    const row = screen.getByText('ACME Ltda').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: t('nfe.viewPanel') }));
    await waitFor(() => screen.getByRole('button', { name: t('nfe.emitSefaz') }));
    await user.click(screen.getByRole('button', { name: t('nfe.emitSefaz') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/v1/invoices/inv-1/emit'), {});
    });
  });
});

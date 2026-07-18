import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompanyPage } from '../CompanyPage';
import ptBR from '../../../i18n/pt-BR';

// Integração fiscal automatizada (regra 70): registro assíncrono da empresa +
// upload síncrono de certificado + teste de conexão. A UI nunca menciona o
// nome do provedor por trás (Focus) — só o estado da integração em si.

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
    user: { name: 'Test', role: 'owner', permissions: ['company:view', 'company:edit'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const COMPANY_BASE = {
  id: 'company-1', is_default: true, is_active: true,
  cnpj: '12345678000190', razao_social: 'ACME Ltda', regime_tributario: 1,
  focus_ambiente: 2, emite_nfe: true, emite_nfse: true,
  fiscal_integration_ref: null as string | null,
  fiscal_registration_status: null as string | null,
  fiscal_registration_error: null as string | null,
  certificado_cnpj: null as string | null,
  certificado_valido_de: null as string | null,
  certificado_valido_ate: null as string | null,
};

function setupMocks(company: Partial<typeof COMPANY_BASE> = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/v1/tenant') return Promise.resolve({ id: 'tenant-123', company_name: 'ACME Ltda', billing_provider: 'itau' });
    if (url.startsWith('/v1/nfe-config')) return Promise.resolve({ ...COMPANY_BASE, ...company });
    if (url.startsWith('/v1/notification-config')) return Promise.resolve({ notify_receivable_due_days: 3 });
    if (url === '/v1/companies') return Promise.resolve({ data: [{ ...COMPANY_BASE, ...company }] });
    if (url === '/v1/bank-accounts') return Promise.resolve({ data: [] });
    if (url === '/v1/tenant/modules') return Promise.resolve({ available: [], enabled: [] });
    return Promise.resolve({});
  });
}

async function renderOnFiscalTab() {
  render(<CompanyPage />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByDisplayValue('ACME Ltda')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: t('comp.tabFiscal') }));
  return user;
}

describe('CompanyPage — Integração Fiscal automatizada (regra 70)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('nunca exibe o nome do provedor (Focus) em nenhum texto da tela', async () => {
    setupMocks();
    await renderOnFiscalTab();

    await waitFor(() => expect(screen.getByText(t('comp.fiscalIntegration.title'))).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/focus/i);
  });

  it('mostra status "Não registrada" e o botão de registrar quando nunca foi solicitado', async () => {
    setupMocks();
    await renderOnFiscalTab();

    await waitFor(() => {
      expect(screen.getByText(t('comp.fiscalIntegration.status.not_registered'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: t('comp.fiscalIntegration.register') })).toBeEnabled();
    });
    // Sem fiscal_integration_ref ainda — nem certificado nem teste de conexão aparecem.
    expect(screen.queryByRole('button', { name: t('comp.fiscalIntegration.test') })).not.toBeInTheDocument();
  });

  it('clicar em "Registrar empresa" chama o endpoint de registro e recarrega a lista', async () => {
    setupMocks();
    mockPost.mockImplementation((url: string) => {
      if (url.endsWith('/fiscal-integration/register')) return Promise.resolve({ status: 'processing' });
      return Promise.resolve({});
    });
    const user = await renderOnFiscalTab();

    await user.click(await screen.findByRole('button', { name: t('comp.fiscalIntegration.register') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v1/companies/company-1/fiscal-integration/register', {});
      expect(screen.getByText(t('comp.fiscalIntegration.registerStarted'))).toBeInTheDocument();
    });
  });

  it('empresa já registrada mostra o botão de teste de conexão e o upload de certificado', async () => {
    setupMocks({ fiscal_integration_ref: 'ref-123', fiscal_registration_status: 'registered' });
    await renderOnFiscalTab();

    await waitFor(() => {
      expect(screen.getByText(t('comp.fiscalIntegration.status.registered_no_certificate'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: t('comp.fiscalIntegration.test') })).toBeEnabled();
      expect(screen.getByRole('button', { name: t('comp.fiscalIntegration.certUpload') })).toBeInTheDocument();
    });
    // Sem arquivo/senha ainda — botão de upload desabilitado.
    expect(screen.getByRole('button', { name: t('comp.fiscalIntegration.certUpload') })).toBeDisabled();
  });

  it('clicar em "Testar conexão" chama o endpoint de teste e mostra o resultado', async () => {
    setupMocks({ fiscal_integration_ref: 'ref-123', fiscal_registration_status: 'registered' });
    mockPost.mockImplementation((url: string) => {
      if (url.endsWith('/fiscal-integration/test')) return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });
    const user = await renderOnFiscalTab();

    await user.click(await screen.findByRole('button', { name: t('comp.fiscalIntegration.test') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v1/companies/company-1/fiscal-integration/test', {});
      expect(screen.getByText(t('comp.fiscalIntegration.testOk'))).toBeInTheDocument();
    });
  });
});

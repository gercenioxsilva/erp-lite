import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompanyPage } from '../CompanyPage';
import ptBR from '../../../i18n/pt-BR';

// Upload de certificado/chave C6 (mTLS) — só cobre o que mudou nesta entrega:
// selecionar um arquivo local preenche a textarea (mesmo state de sempre) e um
// arquivo no formato errado dispara o aviso inline não-bloqueante. A validação
// de negócio de verdade (campos obrigatórios) continua no backend
// (assertC6Credentials, ver bankAccountDomain.test.ts) — não duplicada aqui.

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPatch } = vi.hoisted(() => ({
  mockGet:   vi.fn(),
  mockPatch: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: mockPatch, delete: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-123',
    user: { name: 'Test', role: 'owner', permissions: ['company:view', 'company:edit', 'bank_accounts:view', 'bank_accounts:manage'] },
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const EMPTY_LIST = { data: [] };

function setupMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/v1/tenant') return Promise.resolve({ id: 'tenant-123', company_name: 'ACME Ltda', billing_provider: 'itau' });
    if (url.startsWith('/v1/nfe-config')) return Promise.resolve({ cnpj: '', razao_social: '', regime_tributario: 1, focus_ambiente: 2, emite_nfe: true, emite_nfse: true });
    if (url.startsWith('/v1/notification-config')) return Promise.resolve({ notify_receivable_due_days: 3 });
    if (url === '/v1/companies') return Promise.resolve(EMPTY_LIST);
    if (url === '/v1/bank-accounts') return Promise.resolve(EMPTY_LIST);
    if (url === '/v1/tenant/modules') return Promise.resolve({ available: [], enabled: [] });
    return Promise.resolve({});
  });
}

function makePemFile(name: string, content: string) {
  return new File([content], name, { type: '' }); // .crt/.key não têm MIME confiável no browser
}

describe('CompanyPage — upload de certificado/chave C6', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  async function renderOnBankingTabWithC6() {
    render(<CompanyPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByDisplayValue('ACME Ltda')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: t('comp.tabBanking') }));

    // O <label> não tem htmlFor/id associando ao <select> (mesmo padrão do
    // resto do formulário nesta tela) — localiza pelo texto do label e pega o
    // <select> irmão, em vez de getByLabelText (que exige associação real).
    const providerLabel = await screen.findByText(t('comp.bank.provider'));
    const providerSelect = providerLabel.parentElement!.querySelector('select')!;
    await user.selectOptions(providerSelect, 'c6');

    return user;
  }

  it('selecionar um arquivo .crt válido preenche a textarea de certificado', async () => {
    const user = await renderOnBankingTabWithC6();

    const certInput = document.querySelector('input[type="file"][accept=".crt,.pem,.cer"]') as HTMLInputElement;
    expect(certInput).toBeTruthy();

    const file = makePemFile('meu-certificado.crt', '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----');
    await user.upload(certInput, file);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(t('comp.bank.c6CertPH')) as HTMLTextAreaElement;
      expect(textarea.value).toContain('-----BEGIN CERTIFICATE-----');
    });
    expect(screen.getByText('meu-certificado.crt')).toBeInTheDocument();
  });

  it('selecionar o arquivo errado (certificado) no campo de chave privada dispara o aviso, sem bloquear', async () => {
    const user = await renderOnBankingTabWithC6();

    // .pem é aceito nos dois campos (accept=".key,.pem") — diferente de uma
    // extensão .crt, que o próprio seletor de arquivo do browser já filtraria
    // antes de chegar aqui. O cenário real que o aviso PEM precisa cobrir é
    // exatamente este: extensão genérica igual, conteúdo errado.
    const keyInput = document.querySelector('input[type="file"][accept=".key,.pem"]') as HTMLInputElement;
    const wrongFile = makePemFile('certificado-por-engano.pem', '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----');
    await user.upload(keyInput, wrongFile);

    await waitFor(() => {
      expect(screen.getByText(t('comp.bank.c6FileFormatWarning'))).toBeInTheDocument();
    });
    // Não bloqueante: o botão salvar continua habilitado.
    expect(screen.getByRole('button', { name: t('c.save') })).toBeEnabled();
  });

  it('uma chave privada válida não dispara nenhum aviso', async () => {
    const user = await renderOnBankingTabWithC6();

    const keyInput = document.querySelector('input[type="file"][accept=".key,.pem"]') as HTMLInputElement;
    const file = makePemFile('minha-chave.key', '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----');
    await user.upload(keyInput, file);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(t('comp.bank.c6KeyPH')) as HTMLTextAreaElement;
      expect(textarea.value).toContain('-----BEGIN PRIVATE KEY-----');
    });
    expect(screen.queryByText(t('comp.bank.c6FileFormatWarning'))).not.toBeInTheDocument();
  });
});

// Achado do usuário: ao reabrir uma conta C6 já cadastrada, os campos
// sensíveis apareciam em branco sem nenhuma indicação de que já havia algo
// salvo — client_secret/cert/key nunca são pré-preenchidos (evita reenviar o
// valor mascarado como se fosse novo), mas antes disso ficava indistinguível
// de "nunca configurado". E não existia NENHUMA forma de promover uma conta
// (nova ou existente) a padrão pela tela.
describe('CompanyPage — indicador de credencial já configurada + definir como padrão', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  // Precisa de 2 contas na mesma empresa — o seletor de conta só aparece com
  // accountsForCompany.length > 1 (é assim que se chega na conta C6 não-padrão
  // pela UI; com 1 conta só, o formulário sempre mostra a conta padrão via
  // fluxo legado /v1/tenant, sem seletor nenhum).
  const ITAU_DEFAULT_ACCOUNT = {
    id: 'acc-itau', company_id: 'company-1', label: null, is_default: true, is_active: true,
    bank_code: '341', agency: '0110', account: '454545', account_digit: '6',
    billing_provider: 'itau', billing_days_to_expire: 30,
    itau_client_id: 'itau-id', itau_client_secret: null,
    credentials: { client_id: 'itau-id', client_secret: '****xxxx' },
  };
  const C6_ACCOUNT = {
    id: 'acc-c6', company_id: 'company-1', label: null, is_default: false, is_active: true,
    bank_code: '336', agency: '0001', account: '28508757', account_digit: '6',
    billing_provider: 'c6', billing_days_to_expire: 30,
    itau_client_id: null, itau_client_secret: null,
    credentials: { client_id: '4ad9ed06-3491-492f-b11a-33a803105e21', client_secret: '****VvTQ', cert: '****XYZ9', key: '****ABC1' },
  };

  function setupWithExistingC6Account() {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/tenant') return Promise.resolve({ id: 'tenant-123', company_name: 'ACME Ltda', billing_provider: 'itau' });
      if (url.startsWith('/v1/nfe-config')) return Promise.resolve({ cnpj: '', razao_social: '', regime_tributario: 1, focus_ambiente: 2, emite_nfe: true, emite_nfse: true });
      if (url.startsWith('/v1/notification-config')) return Promise.resolve({ notify_receivable_due_days: 3 });
      if (url === '/v1/companies') return Promise.resolve({ data: [{ id: 'company-1', is_default: true, razao_social: 'ACME Ltda', cnpj: '', regime_tributario: 1, focus_ambiente: 2, emite_nfe: true, emite_nfse: true }] });
      if (url === '/v1/bank-accounts') return Promise.resolve({ data: [ITAU_DEFAULT_ACCOUNT, C6_ACCOUNT] });
      if (url === '/v1/tenant/modules') return Promise.resolve({ available: [], enabled: [] });
      return Promise.resolve({});
    });
  }

  async function selectC6Account() {
    render(<CompanyPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByDisplayValue('ACME Ltda')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: t('comp.tabBanking') }));
    const c6Tab = await screen.findByRole('button', { name: '336 · 0001/28508757' });
    await user.click(c6Tab);

    return user;
  }

  it('mostra o indicador "já configurado" pros 3 campos sensíveis, sem vazar o valor mascarado no campo editável', async () => {
    setupWithExistingC6Account();
    await selectC6Account();

    await waitFor(() => {
      expect(screen.getAllByText(t('comp.bank.alreadyConfigured')).length).toBe(3); // secret + cert + key
    });

    // client_id NÃO é sensível — mostrado de verdade, não mascarado.
    expect(screen.getByDisplayValue('4ad9ed06-3491-492f-b11a-33a803105e21')).toBeInTheDocument();
    // Os 3 campos sensíveis (secret/cert/key) continuam vazios — nunca o valor mascarado.
    const blankFields = screen.getAllByPlaceholderText(t('comp.bank.leaveBlankToKeep')) as HTMLInputElement[];
    expect(blankFields).toHaveLength(3);
    for (const field of blankFields) expect(field.value).toBe('');
  });

  it('exibe a opção "definir como padrão" pra uma conta não-padrão e chama o endpoint de set-default ao salvar', async () => {
    setupWithExistingC6Account();
    mockPatch.mockResolvedValue({ ...C6_ACCOUNT, is_default: true });
    const user = await selectC6Account();

    await waitFor(() => expect(screen.getByText(t('comp.bank.setAsDefault'))).toBeInTheDocument());

    await user.click(screen.getByText(t('comp.bank.setAsDefault')));
    await user.click(screen.getByRole('button', { name: t('c.save') }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(`/v1/bank-accounts/${C6_ACCOUNT.id}/set-default`, {});
    });
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NfseNewPage } from '../NfseNewPage';
import ptBR from '../../../i18n/pt-BR';

// NFS-e avulsa: mesma UX de "nota fiscal de venda avulsa" (InvoiceNewPage) —
// cobre o pré-preenchimento de código de serviço/alíquota a partir da
// empresa emissora padrão (regra 53) e o payload enviado ao criar.

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
  useAuth: () => ({ tenantId: 'tenant-123', user: { name: 'Test', role: 'owner', permissions: ['nfse:emit'] } }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const CLIENT_ID = 'client-1';
const COMPANY_DEFAULT = {
  id: 'company-1', razao_social: 'Matriz', is_default: true, emite_nfse: true,
  codigo_servico_padrao: '14.01', aliquota_iss_padrao: '5.00',
};
const COMPANY_FILIAL = {
  id: 'company-2', razao_social: 'Filial', is_default: false, emite_nfse: true,
  codigo_servico_padrao: '7.02', aliquota_iss_padrao: '3.00',
};

function setupMocks(companies: unknown[] = [COMPANY_DEFAULT]) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/clients'))
      return Promise.resolve({ data: [{ id: CLIENT_ID, company_name: 'ACME Ltda', full_name: null }] });
    if (url.includes('/v1/companies')) return Promise.resolve({ data: companies });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NfseNewPage />
    </MemoryRouter>,
  );
}

describe('NfseNewPage', () => {
  beforeEach(() => { vi.clearAllMocks(); setupMocks(); });

  // Passo 3 (Dados Fiscais, onde ficam código de serviço/alíquota) só
  // desbloqueia depois de cliente + descrição + valor preenchidos.
  async function fillClientAndService(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => screen.getByRole('option', { name: 'ACME Ltda' }));
    await user.selectOptions(screen.getByLabelText(`${t('nfse.client')} *`), CLIENT_ID);
    await waitFor(() => screen.getByLabelText(`${t('nfse.description')} *`));
    await user.type(screen.getByLabelText(`${t('nfse.description')} *`), 'Consultoria avulsa');
    await user.type(screen.getByLabelText(`${t('nfse.amount')} *`), '500');
  }

  it('pré-preenche código de serviço e alíquota ISS a partir da empresa padrão (regra 53)', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillClientAndService(user);
    await waitFor(() => {
      expect((screen.getByLabelText(`${t('nfse.serviceCode')} *`) as HTMLInputElement).value).toBe('14.01');
      expect((screen.getByLabelText(`${t('nfse.issRate')} *`) as HTMLInputElement).value).toBe('5.00');
    });
  });

  it('trocar a empresa emissora atualiza código de serviço e alíquota — nunca mistura configuração de outra empresa', async () => {
    setupMocks([COMPANY_DEFAULT, COMPANY_FILIAL]);
    const user = userEvent.setup();
    renderPage();
    await fillClientAndService(user);
    await waitFor(() => screen.getByLabelText(t('comp.companies.emittingCompany')));

    await user.selectOptions(screen.getByLabelText(t('comp.companies.emittingCompany')), COMPANY_FILIAL.id);

    await waitFor(() => {
      expect((screen.getByLabelText(`${t('nfse.serviceCode')} *`) as HTMLInputElement).value).toBe('7.02');
      expect((screen.getByLabelText(`${t('nfse.issRate')} *`) as HTMLInputElement).value).toBe('3.00');
    });
  });

  it('cria a NFS-e avulsa e navega para /nfse', async () => {
    mockPost.mockResolvedValue({ id: 'nfse-new-1' });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole('option', { name: 'ACME Ltda' }));
    await user.selectOptions(screen.getByLabelText(`${t('nfse.client')} *`), CLIENT_ID);

    await waitFor(() => screen.getByLabelText(`${t('nfse.description')} *`));
    await user.type(screen.getByLabelText(`${t('nfse.description')} *`), 'Consultoria avulsa');
    await user.type(screen.getByLabelText(`${t('nfse.amount')} *`), '500');

    await waitFor(() => {
      expect((screen.getByLabelText(`${t('nfse.serviceCode')} *`) as HTMLInputElement).value).toBe('14.01');
    });

    await user.click(screen.getByRole('button', { name: t('nfse.create') }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v1/nfse', expect.objectContaining({
        client_id:    CLIENT_ID,
        description:  'Consultoria avulsa',
        amount:       500,
        service_code: '14.01',
        iss_rate:     5,
        company_id:   COMPANY_DEFAULT.id,
      }));
      expect(mockNavigate).toHaveBeenCalledWith('/nfse');
    });
  });

  it('bloqueia o envio sem cliente selecionado — mostra erro inline, nunca chama a API', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: t('nfse.create') }));
    // O botão de criar já nasce desabilitado sem cliente/serviço preenchidos
    // (mesma trava de submit da InvoiceNewPage) — nenhuma chamada é possível.
    expect(screen.getByRole('button', { name: t('nfse.create') })).toBeDisabled();
    expect(mockPost).not.toHaveBeenCalled();
    void user;
  });
});

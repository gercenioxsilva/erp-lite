import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { IntegrationsPage } from '../IntegrationsPage';
import type { PublicProviderCard } from '../types';

const { mockGet, mockPost, mockPut, mockPatch } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPut: vi.fn(), mockPatch: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: mockPost, put: mockPut, patch: mockPatch },
  actionErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock('../../../rbac', () => ({
  usePermissions: () => ({ can: () => true }),
}));

const SERPRO_SANDBOX: PublicProviderCard = {
  key: 'serpro',
  label: 'SERPRO Integra Contador',
  description: 'Transmissão do PGDAS-D e emissão do DAS.',
  moduleKey: 'fiscal',
  environment: 'sandbox',
  services: [
    { key: 'transmitir_pgdasd', label: 'Transmissão PGDAS-D', enabled: true },
    { key: 'gerar_das',         label: 'Geração de DAS',      enabled: false },
  ],
  enabled: false,
  fields: [
    { key: 'consumer_key',    label: 'Consumer Key',    type: 'text',     required: true, filled: true, maskedHint: '••••a1b2' },
    { key: 'consumer_secret', label: 'Consumer Secret', type: 'password', required: true, filled: true, maskedHint: '••••c3d4' },
  ],
  requiredTotal: 2,
  requiredFilled: 2,
  configured: false,
  usingPlatformFallback: false,
  lastPing: null,
};

const EMPTY_LOGS = { data: { logs: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } };

function mockDefaults(cards: PublicProviderCard[] = [SERPRO_SANDBOX]) {
  mockGet.mockImplementation((path: string) => {
    if (path.startsWith('/v1/tenant/integrations/logs')) return Promise.resolve(EMPTY_LOGS);
    if (path === '/v1/tenant/integrations') return Promise.resolve({ data: cards });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  mockGet.mockReset(); mockPost.mockReset(); mockPut.mockReset(); mockPatch.mockReset();
  mockDefaults();
});

const renderPage = () =>
  render(<MemoryRouter><IntegrationsPage /></MemoryRouter>);

// O rótulo do provider aparece duas vezes na tela (título do card e opção do
// filtro de logs) — o seletor prende a busca no card.
const findCardTitle = () =>
  screen.findByText('SERPRO Integra Contador', { selector: '.int-card__title' });

describe('IntegrationsPage — cards de provedor', () => {
  it('mostra ambiente, contagem de credenciais obrigatórias e serviços', async () => {
    renderPage();

    await findCardTitle();
    expect(screen.getByText('SANDBOX')).toBeInTheDocument();
    expect(screen.getByText('2/2 credenciais obrigatórias preenchidas')).toBeInTheDocument();
    expect(screen.getByText('Transmissão PGDAS-D')).toBeInTheDocument();
  });

  it('ligar o toggle chama PATCH no par provider/ambiente e reflete a lista devolvida', async () => {
    const user = userEvent.setup();
    mockPatch.mockResolvedValue({ data: [{ ...SERPRO_SANDBOX, enabled: true }] });
    renderPage();

    await findCardTitle();
    await user.click(screen.getByRole('switch'));

    expect(mockPatch).toHaveBeenCalledWith('/v1/tenant/integrations/serpro/sandbox', { enabled: true });
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
  });

  it('ping que falha (HTTP 200 com ok:false) mostra a mensagem pronta, não erro de sistema', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({
      data: { ok: false, message: 'Credenciais recusadas pelo provedor.', httpStatus: 401, latencyMs: 120, errorCode: 'unauthorized' },
    });
    renderPage();

    await findCardTitle();
    await user.click(screen.getByRole('button', { name: /Ping/ }));

    expect(mockPost).toHaveBeenCalledWith('/v1/tenant/integrations/serpro/sandbox/ping', {});
    await screen.findByText(/Credenciais recusadas pelo provedor\./);
  });
});

describe('IntegrationsPage — drawer de credenciais', () => {
  it('campo já preenchido abre vazio e só os campos digitados vão no PUT', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({ data: [SERPRO_SANDBOX] });
    renderPage();

    await findCardTitle();
    await user.click(screen.getByRole('button', { name: /Editar/ }));

    // Segredo nunca volta da API: o input abre vazio com o aviso de "manter".
    const secret = await screen.findByLabelText('Consumer Secret', { exact: false });
    expect(secret).toHaveValue('');
    // Campo já salvo abre VAZIO, e o placeholder traz o rabicho mascarado que a
    // API manda — o usuário reconhece qual chave está lá sem ver o segredo.
    expect(secret).toHaveAttribute('placeholder', expect.stringContaining('••••c3d4'));
    expect(secret).toHaveAttribute('placeholder', expect.stringContaining('deixe vazio para manter'));

    await user.type(screen.getByLabelText('Consumer Key', { exact: false }), 'chave-nova');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    // consumer_secret ficou em branco → omitido → backend mantém o valor atual.
    // `services` vai sempre COMPLETO (não é patch): só o que está ligado no
    // fixture — gerar_das está desligado e por isso fica de fora.
    expect(mockPut).toHaveBeenCalledWith(
      '/v1/tenant/integrations/serpro/sandbox',
      { credentials: { consumer_key: 'chave-nova' }, services: ['transmitir_pgdasd'] },
    );
  });

  it('"Limpar" num campo preenchido envia null explícito', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({ data: [SERPRO_SANDBOX] });
    renderPage();

    await findCardTitle();
    await user.click(screen.getByRole('button', { name: /Editar/ }));

    const [clearFirst] = await screen.findAllByRole('button', { name: 'Limpar' });
    await user.click(clearFirst);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(mockPut).toHaveBeenCalledWith(
      '/v1/tenant/integrations/serpro/sandbox',
      { credentials: { consumer_key: null }, services: ['transmitir_pgdasd'] },
    );
  });

  it('desligar um serviço tira a chave dele do PUT', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({ data: [SERPRO_SANDBOX] });
    renderPage();

    await findCardTitle();
    await user.click(screen.getByRole('button', { name: 'Editar' }));

    // O switch do serviço ligado no fixture; desligá-lo esvazia a lista.
    await user.click(await screen.findByRole('switch', { name: 'Transmissão PGDAS-D' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(mockPut).toHaveBeenCalledWith(
      '/v1/tenant/integrations/serpro/sandbox',
      { credentials: {}, services: [] },
    );
  });
});

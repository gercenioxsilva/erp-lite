import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FiscalOverviewPage } from '../FiscalOverviewPage';

const { mockGet, mockNavigate, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    body?: Record<string, unknown>;
    constructor(message: string, status: number, body?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { mockGet: vi.fn(), mockNavigate: vi.fn(), MockApiError };
});

vi.mock('../../../lib/api', () => ({ api: { get: mockGet }, ApiError: MockApiError }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => { mockGet.mockReset(); mockNavigate.mockReset(); });

const COMPANY_OK = {
  company_id: 'co-1', company_name: 'Empresa Boa', has_fiscal_config: true,
  score: 90, alerts: { critical: 0, warning: 0, info: 0 },
  competencia_atual: { competencia: '2026-06', status: 'aberta' },
  das: { competencia: '2026-06', valor: 1000, vencimento: '2026-07-20', dias_restantes: 5, status: 'pendente' },
  error: false,
};

const COMPANY_RUIM = {
  company_id: 'co-2', company_name: 'Empresa Ruim', has_fiscal_config: true,
  score: 30, alerts: { critical: 2, warning: 1, info: 0 },
  competencia_atual: { competencia: '2026-06', status: 'travada' },
  das: { competencia: '2026-06', valor: 500, vencimento: '2026-07-20', dias_restantes: -3, status: 'atrasado' },
  error: false,
};

const COMPANY_SEM_CADASTRO = {
  company_id: 'co-3', company_name: 'Empresa Nova', has_fiscal_config: false,
  score: null, alerts: null, competencia_atual: null, das: null, error: false,
};

const COMPANY_ERRO = {
  company_id: 'co-4', company_name: 'Empresa Erro', has_fiscal_config: true,
  score: null, alerts: null, competencia_atual: null, das: null, error: true,
};

describe('FiscalOverviewPage', () => {
  it('renderiza um card por empresa, ordenado por urgência (score mais baixo primeiro)', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK, COMPANY_RUIM, COMPANY_SEM_CADASTRO] });
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    const cards = await screen.findAllByTestId('fiscal-overview-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Empresa Ruim');
    expect(cards[1]).toHaveTextContent('Empresa Boa');
    expect(cards[2]).toHaveTextContent('Empresa Nova');
    expect(cards[2]).toHaveTextContent('Configurar');
  });

  it('clicar num card navega pra FiscalPage filtrada por aquela empresa', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK, COMPANY_RUIM] });
    const user = userEvent.setup();
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    const card = await screen.findByText('Empresa Boa');
    await user.click(card);

    expect(mockNavigate).toHaveBeenCalledWith('/fiscal/pipeline?company_id=co-1');
  });

  it('redireciona direto pro pipeline quando só há 1 empresa', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK] });
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/fiscal/pipeline', { replace: true }));
  });

  it('renderiza card isolado de erro sem quebrar siblings', async () => {
    mockGet.mockResolvedValue({ data: [COMPANY_OK, COMPANY_ERRO] });
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    const cards = await screen.findAllByTestId('fiscal-overview-card');
    expect(cards).toHaveLength(2);

    // Card de erro deve mostrar mensagem de erro (error: -1 é mais urgente que score: 90)
    expect(cards[0]).toHaveTextContent('Empresa Erro');
    expect(cards[0]).toHaveTextContent('Não foi possível carregar');

    // Card normal deve renderizar sem ser afetado
    expect(cards[1]).toHaveTextContent('Empresa Boa');
    expect(cards[1]).toHaveTextContent('90');
  });

  it('mostra erro com opção de retry quando o fetch do overview falha, sem redirecionar em silêncio', async () => {
    mockGet.mockRejectedValue(new Error('network error'));
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    expect(await screen.findByText('Não foi possível carregar o painel fiscal.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('fiscal-overview-card')).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();

    const retryButton = screen.getByRole('button', { name: 'Tentar novamente' });
    mockGet.mockResolvedValueOnce({ data: [COMPANY_OK, COMPANY_RUIM] });
    const user = userEvent.setup();
    await user.click(retryButton);

    const cards = await screen.findAllByTestId('fiscal-overview-card');
    expect(cards).toHaveLength(2);
  });

  it('mostra aviso de módulo desligado (nunca o erro genérico) quando o backend devolve 403 ModuleNotEnabled', async () => {
    mockGet.mockRejectedValue(new MockApiError('Módulo "fiscal" não está habilitado para este tenant.', 403, { error: 'ModuleNotEnabled' }));
    render(<MemoryRouter><FiscalOverviewPage /></MemoryRouter>);

    expect(await screen.findByText('O módulo Gestão Fiscal está desabilitado para este tenant.')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar o painel fiscal.')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Ir para Minha Empresa → Módulos' }));
    expect(mockNavigate).toHaveBeenCalledWith('/company');
  });
});

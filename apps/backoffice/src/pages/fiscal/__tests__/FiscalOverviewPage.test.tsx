import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FiscalOverviewPage } from '../FiscalOverviewPage';

const { mockGet, mockNavigate } = vi.hoisted(() => ({ mockGet: vi.fn(), mockNavigate: vi.fn() }));

vi.mock('../../../lib/api', () => ({ api: { get: mockGet } }));

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
});

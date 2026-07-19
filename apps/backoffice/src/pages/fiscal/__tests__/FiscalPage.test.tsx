import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FiscalPage } from '../FiscalPage';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), postForm: vi.fn() },
}));

vi.mock('../../../rbac', () => ({
  usePermissions: () => ({ can: () => true }),
}));

const EMPTY = { data: [] };

function mockDefaultResponses() {
  mockGet.mockImplementation((path: string) => {
    if (path === '/v1/companies') {
      return Promise.resolve({ data: [
        { id: 'co-1', razao_social: 'Empresa Um', is_default: true },
        { id: 'co-2', razao_social: 'Empresa Dois', is_default: false },
      ] });
    }
    // score/simulator devolvem objeto único (não lista) — a FiscalPage real já
    // trata 422 (MEI/sem RBT12) com .catch(() => setScore(null)); reproduzir
    // esse caminho aqui evita que o componente tente ler score.findings de um
    // objeto {data:[]} que não tem essa forma.
    if (path.startsWith('/v1/fiscal/score') || path.startsWith('/v1/fiscal/simulator')) {
      return Promise.reject(new Error('sem dados'));
    }
    return Promise.resolve(EMPTY);
  });
}

beforeEach(() => { mockGet.mockReset(); mockDefaultResponses(); });

describe('FiscalPage — seletor de empresa', () => {
  it('carrega score/apuracao/simulador com company_id da empresa selecionada', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/fiscal/pipeline']}><FiscalPage /></MemoryRouter>);

    // exact: false porque a empresa padrão renderiza "Empresa Um (padrão)" —
    // o sufixo é um nó de texto irmão dentro da mesma <option>, então o match
    // exato do RTL (que compara o texto concatenado do nó) nunca bate com o
    // literal "Empresa Um".
    await screen.findByText('Empresa Um', { exact: false });
    mockGet.mockClear();

    await user.selectOptions(screen.getByLabelText('Empresa'), 'co-2');

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/score?company_id=co-2'));
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/apuracao?company_id=co-2'));
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/simulator?company_id=co-2'));
    });
  });

  it('pré-seleciona a empresa a partir de ?company_id= na URL', async () => {
    render(<MemoryRouter initialEntries={['/fiscal/pipeline?company_id=co-2']}><FiscalPage /></MemoryRouter>);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/fiscal/score?company_id=co-2'));
    });
  });
});

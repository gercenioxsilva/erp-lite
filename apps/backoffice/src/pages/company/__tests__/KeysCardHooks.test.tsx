// Regressão do React error #300 ("Rendered fewer hooks than expected") que
// servia TELA BRANCA em /company ao abrir a aba Integrações.
//
// A causa: os dois cards chamavam `useEffect` DEPOIS de dois `return null`
// condicionais. Sequência que quebrava, sem nada de exótico:
//   render 1 → loading=true  → o `if (!loading && ...)` é falso → useEffect roda → 9 hooks
//   load()   → módulo desligado → setLoading(false)
//   render 2 → a condição vira true → `return null` ANTES do useEffect → 8 hooks
//   → React aborta a árvore inteira (não há error boundary) → tela branca.
//
// O caso que reproduz é o MAIS COMUM em produção: tenant com o módulo
// desligado — que é o padrão de todo módulo opcional.

import { Component, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EngineKeysCard } from '../EngineKeysCard';
import { LeadCaptureKeysCard } from '../LeadCaptureKeysCard';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  actionErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

// Com permissão: isola o gate de MÓDULO, que é o que dispara o bug.
vi.mock('../../../rbac', () => ({ usePermissions: () => ({ can: () => true }) }));

// ARMADILHA ao escrever assert aqui: quando o React aborta a árvore, o container
// fica VAZIO — igualzinho ao comportamento correto de "card escondido". Um
// `toBeEmptyDOMElement()` sozinho passa nos DOIS casos e não protege de nada.
// Por isso o boundary registra o erro e o teste afirma que ele não ocorreu.
let caught: Error | null = null;

class Catcher extends Component<{ children: ReactNode }> {
  static getDerivedStateFromError(error: Error) { caught = error; return {}; }
  render() { return this.props.children; }
}

describe('cards de chaves — módulo desligado não pode quebrar a página', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caught = null;
    // Nenhum módulo habilitado — o padrão de um tenant novo.
    mockGet.mockImplementation((url: string) =>
      url === '/v1/tenant/modules'
        ? Promise.resolve({ enabled: [] })
        : Promise.resolve({ data: [] }),
    );
  });

  it('EngineKeysCard não estoura quando o módulo engine está desligado', async () => {
    render(<Catcher><EngineKeysCard /></Catcher>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/tenant/modules'));
    await waitFor(() => expect(caught).toBeNull());
  });

  it('LeadCaptureKeysCard não estoura quando o módulo lead_capture está desligado', async () => {
    render(<Catcher><LeadCaptureKeysCard /></Catcher>);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/tenant/modules'));
    await waitFor(() => expect(caught).toBeNull());
  });

  it('com o módulo LIGADO, o card renderiza (o gate não pode esconder demais)', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/v1/tenant/modules'
        ? Promise.resolve({ enabled: ['lead_capture'] })
        : Promise.resolve({ data: [] }),
    );
    render(<Catcher><LeadCaptureKeysCard /></Catcher>);
    expect(await screen.findByText(/Capta(ç|c)[ãa]o de Leads/i)).toBeInTheDocument();
    expect(caught).toBeNull();
  });
});

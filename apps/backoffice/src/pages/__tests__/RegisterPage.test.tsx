import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from '../RegisterPage';
import ptBR from '../../i18n/pt-BR';

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

/* ── Module mocks (hoisted — see OrdersPage.test.tsx for the same pattern) ── */
const { mockRegister, mockUseAuth, mockUseSubscription, mockNavigate } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUseAuth:  vi.fn(),
  mockUseSubscription: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: mockUseSubscription,
}));

vi.mock('../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

async function fillStep1AndAdvance(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(t('r.legalName')), 'Empresa Teste');
  await user.type(screen.getByLabelText(t('r.taxId')), '11222333000181');
  await user.click(screen.getByRole('button', { name: t('r.continue') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // PlanStep isn't the focus here — an empty/loading plans response is enough
  // for step-3 renders not to crash in the auth-race tests below.
  mockUseSubscription.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
});

// Regression coverage for the bug the code/security review caught: a lazy
// `useState(() => user ? 3 : 1)` initializer can never see `user` populated,
// because AuthContext resolves it asynchronously after mount. The fix made
// step-resolution a `useEffect` on `[authLoading, user]` instead — these tests
// pin that behavior down so it can't silently regress back to the broken form.
describe('RegisterPage — step resume on mount (auth-race regression)', () => {
  it('starts at step 1 (company info) when not authenticated', () => {
    mockUseAuth.mockReturnValue({ register: mockRegister, user: null, loading: false });
    renderPage();
    expect(screen.getByLabelText(t('r.legalName'))).toBeInTheDocument();
  });

  it('jumps straight to step 3 (plan picker) once an already-authenticated user resolves', async () => {
    mockUseAuth.mockReturnValue({
      register: mockRegister,
      user: { id: 'u1', tenant_id: 't1', name: 'Test', email: 'a@b.com', role: 'owner' },
      loading: false,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByLabelText(t('r.legalName'))).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: t('r.skipTrial') })).toBeInTheDocument();
  });

  it('stays on step 1 while the auth check is still loading, even though a user will eventually resolve', () => {
    mockUseAuth.mockReturnValue({ register: mockRegister, user: null, loading: true });
    renderPage();
    expect(screen.getByLabelText(t('r.legalName'))).toBeInTheDocument();
  });
});

describe('RegisterPage — step 1 to 2 transition', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ register: mockRegister, user: null, loading: false });
  });

  it('does not advance past step 1 when required fields are empty', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('r.continue') }));
    expect(screen.getByLabelText(t('r.legalName'))).toBeInTheDocument();
  });

  it('advances to step 2 once company_name and tax_id are filled', async () => {
    renderPage();
    const user = userEvent.setup();
    await fillStep1AndAdvance(user);
    expect(screen.getByLabelText(t('r.email'))).toBeInTheDocument();
  });
});

describe('RegisterPage — account step submission', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ register: mockRegister, user: null, loading: false });
  });

  it('calls register() with the expected payload on success', async () => {
    mockRegister.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await fillStep1AndAdvance(user);

    await user.type(screen.getByLabelText(t('r.email')), 'admin@empresa.com');
    await user.type(screen.getByLabelText(t('r.password')), 'senha1234');
    await user.type(screen.getByLabelText(t('r.confirmPwd')), 'senha1234');
    await user.click(screen.getByRole('button', { name: t('r.create') }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
        company_name: 'Empresa Teste',
        email:        'admin@empresa.com',
        password:     'senha1234',
      }));
    });
  });

  it('shows an inline error and does not call register() when passwords do not match', async () => {
    renderPage();
    const user = userEvent.setup();
    await fillStep1AndAdvance(user);

    await user.type(screen.getByLabelText(t('r.email')), 'admin@empresa.com');
    await user.type(screen.getByLabelText(t('r.password')), 'senha1234');
    await user.type(screen.getByLabelText(t('r.confirmPwd')), 'outrasenha');
    await user.click(screen.getByRole('button', { name: t('r.create') }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t('r.errPwdMatch'));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('clears the error banner when going back to step 1', async () => {
    renderPage();
    const user = userEvent.setup();
    await fillStep1AndAdvance(user);
    await user.type(screen.getByLabelText(t('r.email')), 'admin@empresa.com');
    await user.type(screen.getByLabelText(t('r.password')), 'senha1234');
    await user.type(screen.getByLabelText(t('r.confirmPwd')), 'outrasenha');
    await user.click(screen.getByRole('button', { name: t('r.create') }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('r.back') }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

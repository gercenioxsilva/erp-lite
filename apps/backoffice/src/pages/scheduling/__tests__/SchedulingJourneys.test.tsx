import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { SchedulingDashboardPage } from '../SchedulingDashboardPage';
import { SchedulingCalendarPage } from '../SchedulingCalendarPage';
import { SessionFormDrawer } from '../SessionFormDrawer';

// Fixes de auditoria das jornadas:
// 1. Dashboard só redireciona pro onboarding quem PODE configurá-lo — o
//    profissional (sem scheduling:settings) caía num /403.
// 2. Calendário ancora no PRÓPRIO profissional quando não há manage_all —
//    antes abria no primeiro colega da lista (grade vazia + 403 engolido).

const { mockGet, mockNavigate, mockPerms } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockNavigate: vi.fn(), mockPerms: { set: new Set<string>() },
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../../../rbac', () => ({
  usePermissions: () => ({ can: (p: string) => mockPerms.set.has(p) }),
  Can: ({ permission, children }: { permission: string; children: React.ReactNode }) =>
    mockPerms.set.has(permission) ? <>{children}</> : null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test', role: 'professional', permissions: [] }, tenantId: 't1' }),
}));
vi.mock('../../../contexts/ModalContext', () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), error: vi.fn(), success: vi.fn() }),
}));

const DASH_INCOMPLETE = { onboarding_complete: false, today: [], upcoming: [], pending_requests: 0 };

describe('SchedulingDashboardPage — guard do onboarding', () => {
  beforeEach(() => { vi.clearAllMocks(); mockPerms.set = new Set(['scheduling:view']); });

  it('PROFISSIONAL (sem scheduling:settings) NÃO é redirecionado pro onboarding', async () => {
    mockGet.mockResolvedValue(DASH_INCOMPLETE);
    render(<MemoryRouter><SchedulingDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalledWith('/scheduling/onboarding');
  });

  it('ADMIN (com scheduling:settings) é redirecionado quando falta onboarding', async () => {
    mockPerms.set = new Set(['scheduling:view', 'scheduling:settings']);
    mockGet.mockResolvedValue(DASH_INCOMPLETE);
    render(<MemoryRouter><SchedulingDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/scheduling/onboarding'));
  });
});

describe('SchedulingCalendarPage — agenda ancorada no próprio profissional', () => {
  const PROFS = { data: [
    { id: 'p-admin', name: 'Admin', is_active: true, area_ids: [] },
    { id: 'p-me', name: 'Eu Profissional', is_active: true, area_ids: [] },
  ] };

  function setupApi(me: { id: string } | null) {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/professionals/me')) return me ? Promise.resolve(me) : Promise.reject(new Error('404'));
      if (url.includes('/professionals')) return Promise.resolve(PROFS);
      if (url.includes('/areas')) return Promise.resolve({ data: [] });
      if (url.includes('/sessions')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
  }

  beforeEach(() => vi.clearAllMocks());

  it('sem manage_all + vinculado: seleção trava em si mesmo (dropdown desabilitado, só a própria opção)', async () => {
    mockPerms.set = new Set(['scheduling:view', 'scheduling:manage']);
    setupApi({ id: 'p-me' });
    render(<MemoryRouter><SchedulingCalendarPage /></MemoryRouter>);
    const select = await screen.findByLabelText('Profissional');
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('p-me'));
    expect(select).toBeDisabled();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument(); // colega some da lista
    expect(screen.getByText('Eu Profissional (você)')).toBeInTheDocument();
  });

  it('com manage_all: vê todos e pré-seleciona a própria agenda quando existe', async () => {
    mockPerms.set = new Set(['scheduling:view', 'scheduling:manage', 'scheduling:manage_all']);
    setupApi({ id: 'p-me' });
    render(<MemoryRouter><SchedulingCalendarPage /></MemoryRouter>);
    const select = await screen.findByLabelText('Profissional');
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('p-me'));
    expect(select).not.toBeDisabled();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});


describe('SessionFormDrawer — combobox único de cliente (fix de UX)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerms.set = new Set(['scheduling:view', 'scheduling:manage']);
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/clients')) {
        // Respeita o ?search= como o backend real (ilike)
        const m = /search=([^&]+)/.exec(url);
        const q = m ? decodeURIComponent(m[1]).toLowerCase() : '';
        const all = [
          { id: 'c1', company_name: 'Cliente Demo PJ Ltda', full_name: null },
          { id: 'c2', company_name: null, full_name: 'Maria Consumidora' },
        ];
        return Promise.resolve({ data: all.filter(c => (c.company_name ?? c.full_name ?? '').toLowerCase().includes(q)) });
      }
      if (url.includes('/scheduling/areas')) return Promise.resolve({ data: [] });
      if (url.includes('/client-packages')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
  });

  it('digitar filtra a lista e clicar SELECIONA (um controle só, sem select redundante)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SessionFormDrawer open onClose={() => {}} onSaved={() => {}} /></MemoryRouter>);

    const box = await screen.findByRole('combobox', { name: /cliente/i });
    await user.click(box);
    await user.type(box, 'Maria');

    // aparece só a Maria; clica e vira o valor do campo
    const option = await screen.findByRole('button', { name: /Maria Consumidora/ });
    expect(screen.queryByText(/Cliente Demo PJ/)).not.toBeInTheDocument();
    await user.click(option);

    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: /cliente/i }) as HTMLInputElement).value)
        .toMatch(/Maria Consumidora/);
    });
    // lista fechou e NÃO existe um <select> de cliente separado
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('busca sem resultado mostra aviso em vez de parecer quebrada', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SessionFormDrawer open onClose={() => {}} onSaved={() => {}} /></MemoryRouter>);
    const box = await screen.findByRole('combobox', { name: /cliente/i });
    await user.click(box);
    await user.type(box, 'inexistente');
    await waitFor(() => {
      expect(screen.getByText(/Nenhum cliente encontrado para "inexistente"/)).toBeInTheDocument();
    });
  });
});

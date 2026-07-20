import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PortalLayout } from '../PortalLayout';

// Fix de auditoria: a aba "Agendar" era exibida SEMPRE — com self-booking
// desligado virava uma aba morta com um aviso dentro. Agora só aparece
// quando o tenant permite auto-agendamento.

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'client', name: 'Cliente' }, logout: vi.fn() }),
}));

const ME = (allowSelfBooking: boolean) => ({
  client: { id: 'c1', full_name: 'Cliente Demo', company_name: null, email: null, phone: null },
  user: { email: 'cliente@erp.local', name: 'Cliente Demo' },
  business: {
    business_name: 'Studio', business_type: 'clinic',
    allow_self_booking: allowSelfBooking, min_advance_hours: 12, cancel_window_hours: 0,
  },
});

function renderPortal(allow: boolean) {
  mockGet.mockResolvedValue(ME(allow));
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <Routes>
        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PortalLayout — aba Agendar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('esconde "Agendar" quando o auto-agendamento está desligado', async () => {
    renderPortal(false);
    await waitFor(() => screen.getByText('Início'));
    expect(screen.queryByText('Agendar')).not.toBeInTheDocument();
    expect(screen.getByText('Sessões')).toBeInTheDocument();
  });

  it('mostra "Agendar" quando o tenant permite auto-agendamento', async () => {
    renderPortal(true);
    await waitFor(() => screen.getByText('Início'));
    expect(screen.getByText('Agendar')).toBeInTheDocument();
  });
});

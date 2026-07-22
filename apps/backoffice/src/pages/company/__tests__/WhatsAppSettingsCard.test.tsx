import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ptBR from '../../../i18n/pt-BR';

// Regra 83: consolidação das configurações de WhatsApp (antes espalhadas
// entre esta seção — só a conexão — e a tela solta /whatsapp no menu
// Comercial) dentro de Minha Empresa > Integrações, com checklist de
// configuração e o resultado da última tentativa de disparo visível por
// automação (antes, uma falha de elegibilidade era só um console.warn).

const t = (k: string): string => (ptBR as Record<string, string>)[k] ?? k;

const { mockGet, mockPatch } = vi.hoisted(() => ({
  mockGet:   vi.fn(),
  mockPatch: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: mockGet, post: vi.fn(), patch: mockPatch, delete: vi.fn() },
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t, lang: 'pt-BR' }),
}));

function mockAuth(permissions: string[]) {
  vi.doMock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ tenantId: 'tenant-123', user: { name: 'Test', role: 'owner', permissions } }),
  }));
}

const ACCOUNT_CONNECTED = { id: 'acc-1', provider: 'twilio', whatsapp_number: '+5511999999999', display_name: null, status: 'connected' as const };

const AUTOMATIONS = [
  { template_key: 'invoice_due_soon', enabled: true, config: { days_before: 3 }, last_attempt_status: 'sent' as const, last_skip_reason: null },
  { template_key: 'invoice_overdue', enabled: true, config: { days_after: 3 }, last_attempt_status: 'skipped' as const, last_skip_reason: 'account_not_connected' },
  { template_key: 'payment_confirmed', enabled: false, config: {}, last_attempt_status: null, last_skip_reason: null },
  { template_key: 'fiscal_document_authorized', enabled: false, config: {}, last_attempt_status: null, last_skip_reason: null },
  { template_key: 'proposal_sent', enabled: false, config: {}, last_attempt_status: null, last_skip_reason: null },
];

const TEMPLATES = [
  { template_key: 'invoice_due_soon', variables: [], body_preview: 'p1', provider_template_id: 'HX1', status: 'approved' as const },
  { template_key: 'invoice_overdue', variables: [], body_preview: 'p2', provider_template_id: 'HX2', status: 'approved' as const },
  { template_key: 'payment_confirmed', variables: [], body_preview: 'p3', provider_template_id: null, status: 'pending_approval' as const },
  { template_key: 'fiscal_document_authorized', variables: [], body_preview: 'p4', provider_template_id: null, status: 'pending_approval' as const },
  { template_key: 'proposal_sent', variables: [], body_preview: 'p5', provider_template_id: null, status: 'pending_approval' as const },
];

function setupMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/v1/tenant/modules') return Promise.resolve({ enabled: ['whatsapp'] });
    if (url === '/v1/whatsapp/account') return Promise.resolve(ACCOUNT_CONNECTED);
    if (url === '/v1/whatsapp/automations') return Promise.resolve({ data: AUTOMATIONS });
    if (url === '/v1/whatsapp/templates') return Promise.resolve({ data: TEMPLATES });
    if (url.startsWith('/v1/whatsapp/messages')) return Promise.resolve({ data: [], total: 0 });
    return Promise.resolve({});
  });
}

describe('WhatsAppSettingsCard — consolidação em Minha Empresa > Integrações (regra 83)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMocks();
  });

  it('não renderiza nada sem a permissão whatsapp:view (backend recusaria de qualquer forma)', async () => {
    mockAuth([]);
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    const { container } = render(<Card />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    // Só o check de módulo roda (efeito incondicional); nenhuma chamada de
    // dados sensíveis (/whatsapp/account|automations|templates) acontece.
    expect(mockGet).not.toHaveBeenCalledWith('/v1/whatsapp/account');
    expect(mockGet).not.toHaveBeenCalledWith('/v1/whatsapp/automations');
  });

  it('não renderiza nada quando o módulo whatsapp está desligado no tenant', async () => {
    mockAuth(['whatsapp:view', 'whatsapp:manage']);
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/tenant/modules') return Promise.resolve({ enabled: [] });
      return Promise.resolve({});
    });
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    const { container } = render(<Card />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('mostra o checklist de configuração com conta conectada, templates aprovados e automações ativas', async () => {
    mockAuth(['whatsapp:view', 'whatsapp:manage']);
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    render(<Card />);

    await waitFor(() => expect(screen.getByText(t('wa.checklist.connected'))).toBeInTheDocument());
    expect(screen.getByText(`2 ${t('c.of')} 5 ${t('wa.checklist.approved')}`)).toBeInTheDocument();
    expect(screen.getByText(`2 ${t('c.of')} 5 ${t('wa.checklist.active')}`)).toBeInTheDocument();
  });

  it('sinaliza "precisa de atenção" quando uma automação ativa está sendo pulada, com o motivo na aba Automações', async () => {
    mockAuth(['whatsapp:view', 'whatsapp:manage']);
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    render(<Card />);

    await waitFor(() => expect(screen.getByText(t('wa.checklist.attentionTitle') + ':')).toBeInTheDocument());
    expect(screen.getByText(
      `${t('wa.lastAttempt.skippedPrefix')} ${t('wa.skipReason.account_not_connected')}`,
    )).toBeInTheDocument();
    expect(screen.getByText(t('wa.lastAttempt.sent'))).toBeInTheDocument();
  });

  it('liga uma automação desligada chamando o PATCH com o payload correto', async () => {
    mockAuth(['whatsapp:view', 'whatsapp:manage']);
    mockPatch.mockResolvedValue({});
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    render(<Card />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(t('wa.template.payment_confirmed'))).toBeInTheDocument());
    const paymentSwitch = screen.getByLabelText(`${t('wa.template.payment_confirmed')}: ${t('comp.modules.enable')}`);
    await user.click(paymentSwitch);

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/whatsapp/automations/payment_confirmed', { enabled: true, config: {} });
    });
  });

  it('sem whatsapp:manage, os campos de conexão e os switches ficam desabilitados', async () => {
    mockAuth(['whatsapp:view']);
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    render(<Card />);

    await waitFor(() => expect(screen.getByText(t('wa.template.payment_confirmed'))).toBeInTheDocument());
    expect(screen.getByPlaceholderText('+5511999999999')).toBeDisabled();
    const paymentSwitch = screen.getByLabelText(`${t('wa.template.payment_confirmed')}: ${t('comp.modules.enable')}`);
    expect(paymentSwitch).toBeDisabled();
  });

  it('o manual embutido começa fechado e expande ao clicar', async () => {
    mockAuth(['whatsapp:view', 'whatsapp:manage']);
    const { WhatsAppSettingsCard: Card } = await import('../WhatsAppSettingsCard');
    render(<Card />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(t('wa.manual.toggle'))).toBeInTheDocument());
    expect(screen.queryByText(t('wa.manual.step1Title'))).not.toBeInTheDocument();

    await user.click(screen.getByText(t('wa.manual.toggle')));
    expect(screen.getByText(t('wa.manual.step1Title'))).toBeInTheDocument();
  });
});

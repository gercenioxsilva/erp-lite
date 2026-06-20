import { vi, describe, it, expect, beforeEach } from 'vitest';

// Hoist mock variables so they're available inside vi.mock factory
const { mockWhere, mockFrom, mockSelect, mockSend } = vi.hoisted(() => ({
  mockWhere:  vi.fn(),
  mockFrom:   vi.fn(),
  mockSelect: vi.fn(),
  mockSend:   vi.fn(),
}));

vi.mock('../db/index', () => ({
  db: { select: mockSelect },
  notificationConfigs: {
    tenant_id:             'tenant_id',
    email_enabled:         'email_enabled',
    email_from_name:       'email_from_name',
    email_reply_to:        'email_reply_to',
    notify_nfe_authorized: 'notify_nfe_authorized',
    notify_nfe_rejected:   'notify_nfe_rejected',
    notify_order_confirmed:'notify_order_confirmed',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: any, val: any) => ({ col, val }),
}));

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: () => ({ send: mockSend }),
}));

import { sendNotificationIfEnabled } from '../lib/notificationsClient';

const basePayload = {
  tenant_id: 'tenant-uuid-1',
  type: 'nfe_authorized' as const,
  recipient: { email: 'client@example.com', name: 'Client Name' },
  data: { invoice_number: '000000001' },
};

describe('sendNotificationIfEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTIFICATIONS_QUEUE_URL = 'http://sqs.local/queue/notifications';
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it('no-ops when NOTIFICATIONS_QUEUE_URL is not set', async () => {
    delete process.env.NOTIFICATIONS_QUEUE_URL;
    await sendNotificationIfEnabled(basePayload);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('no-ops when notification_configs row not found', async () => {
    mockWhere.mockResolvedValue([]);
    await sendNotificationIfEnabled(basePayload);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('no-ops when email_enabled is false', async () => {
    mockWhere.mockResolvedValue([{
      email_enabled: false, notify_nfe_authorized: true,
    }]);
    await sendNotificationIfEnabled(basePayload);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('no-ops when specific notification type toggle is false', async () => {
    mockWhere.mockResolvedValue([{
      email_enabled: true, notify_nfe_authorized: false,
    }]);
    await sendNotificationIfEnabled(basePayload);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends SQS message when all conditions met', async () => {
    mockWhere.mockResolvedValue([{
      email_enabled: true,
      email_from_name: 'Test ERP',
      email_reply_to: null,
      notify_nfe_authorized: true,
    }]);
    mockSend.mockResolvedValue({});

    await sendNotificationIfEnabled(basePayload);

    expect(mockSend).toHaveBeenCalledOnce();
    const [cmd] = mockSend.mock.calls[0];
    const body = JSON.parse(cmd.input.MessageBody);
    expect(body.type).toBe('nfe_authorized');
    expect(body.channel).toBe('email');
    expect(body.recipient.email).toBe('client@example.com');
    expect(body.from_name).toBe('Test ERP');
    expect(body.tenant_id).toBe('tenant-uuid-1');
  });

  it('sets reply_to when configured', async () => {
    mockWhere.mockResolvedValue([{
      email_enabled: true, email_from_name: 'ERP', email_reply_to: 'reply@company.com',
      notify_nfe_authorized: true,
    }]);
    mockSend.mockResolvedValue({});

    await sendNotificationIfEnabled(basePayload);

    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
    expect(body.reply_to).toBe('reply@company.com');
  });

  it('sends for order_confirmed type', async () => {
    mockWhere.mockResolvedValue([{
      email_enabled: true, email_from_name: 'ERP', email_reply_to: null,
      notify_order_confirmed: true,
    }]);
    mockSend.mockResolvedValue({});

    await sendNotificationIfEnabled({
      ...basePayload, type: 'order_confirmed',
      data: { order_number: '00001', total: '150.00' },
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
    expect(body.type).toBe('order_confirmed');
  });
});

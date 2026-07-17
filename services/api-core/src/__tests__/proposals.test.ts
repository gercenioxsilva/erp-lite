import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { db } from '../db';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async () => ({ rows: [] })),
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve([]) }),
      })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      transaction: vi.fn(),
    },
  };
});

describe('Proposals routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', email: 'admin@test.com', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/proposals without auth returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proposals',
      payload: { title: 'Test', items: [{ name: 'Item', quantity: 1, unit_price: 100 }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('GET /v1/proposals returns pagination shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/proposals',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/public/proposals/abc returns 404 for short token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/proposals/abc',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/public/proposals/[64 hex] returns 404 when not found', async () => {
    const validToken = 'a'.repeat(64);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/proposals/${validToken}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/public/proposals/[token]/accept without name returns 400', async () => {
    const validToken = 'b'.repeat(64);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/public/proposals/${validToken}/accept`,
      payload: { email: 'test@test.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/public/proposals/abc/reject with invalid token returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/public/proposals/abc/reject',
      payload: { reason: 'Too expensive' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('[regressão] PATCH /v1/proposals/:id persiste notes, valid_until e terms_text (campos extraídos do body mas antes ausentes do UPDATE)', async () => {
    const executeCalls: string[] = [];
    (db.execute as any).mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      executeCalls.push(text);
      if (/SELECT id, status FROM proposals/i.test(text)) return { rows: [{ id: 'prop-1', status: 'draft' }] };
      if (/SELECT quantity, unit_price, discount_pct/i.test(text)) return { rows: [] };
      if (/SELECT discount, shipping FROM proposals/i.test(text)) return { rows: [{ discount: '0', shipping: '0' }] };
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/proposals/prop-1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { notes: 'Entrega combinada por telefone', valid_until: '2026-12-31', terms_text: 'Pagamento à vista' },
    });

    expect(res.statusCode).toBe(200);
    const updateCall = executeCalls.find(c => /UPDATE proposals SET/i.test(c));
    expect(updateCall).toBeDefined();
    expect(updateCall).toMatch(/notes/);
    expect(updateCall).toMatch(/valid_until/);
    expect(updateCall).toMatch(/terms_text/);
  });

  // Editável mesmo após enviada ao cliente (draft/sent/viewed) — desfechos
  // definitivos (accepted/rejected/expired/cancelled) continuam travados.
  describe('PATCH /v1/proposals/:id — editável em draft/sent/viewed', () => {
    function mockStatus(status: string) {
      (db.execute as any).mockImplementation(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/SELECT id, status FROM proposals/i.test(text)) return { rows: [{ id: 'prop-1', status }] };
        if (/SELECT quantity, unit_price, discount_pct/i.test(text)) return { rows: [] };
        if (/SELECT discount, shipping FROM proposals/i.test(text)) return { rows: [{ discount: '0', shipping: '0' }] };
        return { rows: [] };
      });
    }

    it.each(['draft', 'sent', 'viewed'])('permite editar quando status=%s', async (status) => {
      mockStatus(status);
      const res = await app.inject({
        method: 'PATCH', url: '/v1/proposals/prop-1',
        headers: { Authorization: `Bearer ${token}` },
        payload: { notes: 'Ajuste pós-envio' },
      });
      expect(res.statusCode).toBe(200);
    });

    it.each(['accepted', 'rejected', 'expired', 'cancelled'])('bloqueia editar quando status=%s', async (status) => {
      mockStatus(status);
      const res = await app.inject({
        method: 'PATCH', url: '/v1/proposals/prop-1',
        headers: { Authorization: `Bearer ${token}` },
        payload: { notes: 'Tentativa de edição' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('PATCH /v1/proposals/:id persiste commercial_message', async () => {
    const executeCalls: string[] = [];
    (db.execute as any).mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      executeCalls.push(text);
      if (/SELECT id, status FROM proposals/i.test(text)) return { rows: [{ id: 'prop-1', status: 'sent' }] };
      if (/SELECT quantity, unit_price, discount_pct/i.test(text)) return { rows: [] };
      if (/SELECT discount, shipping FROM proposals/i.test(text)) return { rows: [{ discount: '0', shipping: '0' }] };
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'PATCH', url: '/v1/proposals/prop-1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { commercial_message: 'Agradecemos a oportunidade de apresentar esta proposta.' },
    });

    expect(res.statusCode).toBe(200);
    const updateCall = executeCalls.find(c => /UPDATE proposals SET/i.test(c));
    expect(updateCall).toMatch(/commercial_message/);
  });

  it('GET /v1/proposals/:id/print devolve commercial_message', async () => {
    (db.execute as any).mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM proposals p/i.test(text) && /LEFT JOIN tenants/i.test(text)) {
        return { rows: [{ id: 'prop-1', number: '00001', title: 'Proposta X', status: 'draft',
          total: '100', subtotal: '100', discount: '0', shipping: '0',
          commercial_message: 'Mensagem de abertura', notes: null, terms_text: null,
        }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'GET', url: '/v1/proposals/prop-1/print',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().proposal.commercial_message).toBe('Mensagem de abertura');
  });

  describe('POST /v1/proposals/:id/resend', () => {
    function mockProposal(row: Record<string, unknown> | undefined) {
      (db.execute as any).mockImplementation(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/FROM proposals p/i.test(text) && /LEFT JOIN tenants/i.test(text)) {
          return { rows: row ? [row] : [] };
        }
        return { rows: [] };
      });
    }

    it('404 quando a proposta não existe', async () => {
      mockProposal(undefined);
      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it.each(['draft', 'accepted', 'rejected', 'cancelled'])('400 quando status=%s (só sent/viewed/expired podem ser reenviadas)', async (status) => {
      mockProposal({ id: 'prop-1', status, client_email: 'cliente@ex.com', public_token: 'a'.repeat(64), number: '00001', title: 'Proposta X', total: '100' });
      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it.each(['sent', 'viewed', 'expired'])('200 quando status=%s', async (status) => {
      mockProposal({ id: 'prop-1', status, client_email: 'cliente@ex.com', public_token: 'a'.repeat(64), number: '00001', title: 'Proposta X', total: '100' });
      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().link).toContain('a'.repeat(64));
    });

    it('400 quando o cliente não tem e-mail cadastrado', async () => {
      mockProposal({ id: 'prop-1', status: 'sent', client_email: null, public_token: 'a'.repeat(64), number: '00001', title: 'Proposta X', total: '100' });
      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/e-mail/);
    });

    it('400 quando a proposta não tem public_token ainda (nunca foi enviada de verdade)', async () => {
      mockProposal({ id: 'prop-1', status: 'sent', client_email: 'cliente@ex.com', public_token: null, number: '00001', title: 'Proposta X', total: '100' });
      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('nunca muda o status nem o public_token (só reenvia o mesmo e-mail — sem UPDATE nenhum)', async () => {
      const executeCalls: string[] = [];
      const originalImpl = (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        executeCalls.push(text);
        if (/FROM proposals p/i.test(text) && /LEFT JOIN tenants/i.test(text)) {
          return { rows: [{ id: 'prop-1', status: 'sent', client_email: 'cliente@ex.com', public_token: 'a'.repeat(64), number: '00001', title: 'Proposta X', total: '100' }] };
        }
        return { rows: [] };
      };
      (db.execute as any).mockImplementation(async (query: any) => originalImpl(query));

      const res = await app.inject({
        method: 'POST', url: '/v1/proposals/prop-1/resend',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(executeCalls.some(c => /UPDATE proposals/i.test(c))).toBe(false);
    });

    it('401 sem token de autenticação', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/proposals/prop-1/resend' });
      expect(res.statusCode).toBe(401);
    });
  });
});

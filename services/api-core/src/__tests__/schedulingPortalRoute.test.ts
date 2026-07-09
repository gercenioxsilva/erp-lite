// Contrato HTTP do Portal do Cliente — services mockados (já testados em
// schedulingSessionService.test.ts + integração), aqui só: autenticação,
// clientRoleGuard global (papel client preso em /v1/portal/*), vínculo
// users.client_id obrigatório, escopo duro por client_id e o mapeamento de
// erros de domínio. Mesmo padrão de salesPipelineRoute.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

vi.mock('../services/schedulingSessionService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/schedulingSessionService');
  return {
    ...actual,
    listSessions:            vi.fn(),
    requestSessionAsClient:  vi.fn(),
    cancelOwnPendingSession: vi.fn(),
    getAvailableSlots:       vi.fn(),
  };
});

vi.mock('../services/schedulingSettingsService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/schedulingSettingsService');
  return { ...actual, getOrCreateSettings: vi.fn() };
});

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '33333333-3333-3333-3333-333333333333';
const PROF_ID   = '44444444-4444-4444-4444-444444444444';
const AREA_ID   = '55555555-5555-5555-5555-555555555555';

describe('rotas de /v1/portal (portal do cliente)', () => {
  let app: FastifyInstance;
  let sessionSvc: Record<string, ReturnType<typeof vi.fn>>;
  let settingsSvc: Record<string, ReturnType<typeof vi.fn>>;

  const clientToken = () =>
    app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-client', role: 'client' });

  /** Fila de selects do db mockado: requireModule (tenant_modules) vem
   *  primeiro em toda rota gated; depois o lookup de users.client_id. */
  function queueModuleAndLink(clientId: string | null) {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ client_id: clientId }]));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(selectOnce([{ enabled: true }]));
    sessionSvc = await import('../services/schedulingSessionService') as any;
    settingsSvc = await import('../services/schedulingSettingsService') as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/portal/sessions' });
    expect(res.statusCode).toBe(401);
  });

  it('clientRoleGuard: papel client é barrado FORA de /v1/portal/* (403 em /v1/clients)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/clients',
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ClientRoleRestricted');
  });

  it('login sem vínculo com cadastro de cliente ⇒ 403 client_not_linked', async () => {
    queueModuleAndLink(null);
    const res = await app.inject({
      method: 'GET', url: '/v1/portal/sessions',
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('client_not_linked');
  });

  it('minhas sessões: escopo DURO pelo client_id da linha de users, nunca do payload', async () => {
    queueModuleAndLink(CLIENT_ID);
    sessionSvc.listSessions.mockResolvedValue({ data: [], total: 0, page: 1, per_page: 20 });

    const res = await app.inject({
      method: 'GET', url: '/v1/portal/sessions?client_id=outro-cliente-qualquer',
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(sessionSvc.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, clientId: CLIENT_ID }),
    );
  });

  it('solicitação nasce do fluxo do cliente e mapeia slot_unavailable para 422', async () => {
    queueModuleAndLink(CLIENT_ID);
    sessionSvc.requestSessionAsClient.mockRejectedValue(new SchedulingDomainError('slot_unavailable'));

    const res = await app.inject({
      method: 'POST', url: '/v1/portal/sessions',
      headers: { authorization: `Bearer ${clientToken()}` },
      payload: { professional_id: PROF_ID, area_id: AREA_ID, date: '2026-08-17', start_time: '09:00' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('slot_unavailable');
    expect(sessionSvc.requestSessionAsClient).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, clientUserId: 'user-client' }),
    );
  });

  it('slots do portal: auto-agendamento desligado ⇒ 422 self_booking_disabled', async () => {
    queueModuleAndLink(CLIENT_ID);
    settingsSvc.getOrCreateSettings.mockResolvedValue({ allow_self_booking: false });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/portal/slots?professional_id=${PROF_ID}&area_id=${AREA_ID}&date=2026-08-17`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('self_booking_disabled');
    expect(sessionSvc.getAvailableSlots).not.toHaveBeenCalled();
  });

  it('cancelamento do próprio pending delega com a identidade correta', async () => {
    queueModuleAndLink(CLIENT_ID);
    sessionSvc.cancelOwnPendingSession.mockResolvedValue({ id: 'sess-1', status: 'canceled' });

    const res = await app.inject({
      method: 'POST', url: '/v1/portal/sessions/sess-1/cancel',
      headers: { authorization: `Bearer ${clientToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(sessionSvc.cancelOwnPendingSession)
      .toHaveBeenCalledWith('sess-1', TENANT_ID, CLIENT_ID, 'user-client');
  });
});

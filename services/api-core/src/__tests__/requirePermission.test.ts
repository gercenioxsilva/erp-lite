import { describe, it, expect, beforeEach, vi } from 'vitest';

// Isolamos o middleware do serviço de permissões (e, de tabela, do banco).
vi.mock('../rbac/permissionService', () => ({ getPermissionsForUser: vi.fn() }));

import { getPermissionsForUser } from '../rbac/permissionService';
import { requirePermission, requireAnyPermission } from '../lib/requirePermission';

const asMock = getPermissionsForUser as unknown as ReturnType<typeof vi.fn>;

function mkReply() {
  const reply: any = {};
  reply.code = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  reply.unauthorized = vi.fn(() => reply);
  return reply;
}

function mkReq() {
  return { user: { userId: 'u1', tenantId: 't1', role: 'user' }, log: { warn: vi.fn() }, method: 'POST', url: '/v1/clients' } as any;
}

beforeEach(() => vi.clearAllMocks());

describe('requirePermission', () => {
  it('permite quando o usuário tem a permissão', async () => {
    asMock.mockResolvedValue(new Set(['clients:create']));
    const reply = mkReply();
    await requirePermission('clients:create')(mkReq(), reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('nega com 403 + payload PermissionDenied + log quando falta permissão', async () => {
    asMock.mockResolvedValue(new Set(['clients:view']));
    const reply = mkReply();
    const req = mkReq();
    await requirePermission('clients:create')(req, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'PermissionDenied' }));
    expect(req.log.warn).toHaveBeenCalled();
  });

  it('exige TODAS (AND)', async () => {
    asMock.mockResolvedValue(new Set(['a:b']));
    const reply = mkReply();
    await requirePermission('a:b', 'c:d')(mkReq(), reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('401 quando não autenticado', async () => {
    const reply = mkReply();
    await requirePermission('clients:create')({ user: undefined, log: { warn: vi.fn() } } as any, reply);
    expect(reply.unauthorized).toHaveBeenCalled();
    expect(asMock).not.toHaveBeenCalled();
  });
});

describe('requireAnyPermission', () => {
  it('permite se tiver QUALQUER uma (OR)', async () => {
    asMock.mockResolvedValue(new Set(['b:b']));
    const reply = mkReply();
    await requireAnyPermission('a:a', 'b:b')(mkReq(), reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('nega se não tiver nenhuma', async () => {
    asMock.mockResolvedValue(new Set(['z:z']));
    const reply = mkReply();
    await requireAnyPermission('a:a', 'b:b')(mkReq(), reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });
});

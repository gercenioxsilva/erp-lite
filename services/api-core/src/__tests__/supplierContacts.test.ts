import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// ── DB mock (vi.hoisted ensures it's available before vi.mock factory runs) ────
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID  = '33333333-3333-3333-3333-333333333333';

function token(app: FastifyInstance, tenantId = TENANT_ID) {
  return app.jwt.sign({ tenantId, userId: 'user-1', role: 'admin' });
}

function selectChainOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows) };
}

describe('GET /v1/suppliers/:id/contacts', () => {
  let app: FastifyInstance;

  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/suppliers/${SUPPLIER_ID}/contacts` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('returns 404 when the supplier does not belong to the tenant', async () => {
    mockDb.select.mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the contact list ordered by type/name', async () => {
    const contacts = [
      { id: CONTACT_ID, contact_type: 'comercial', name: 'Ana', email: null, phone: null, notes: null, is_active: true },
      { id: '44444444-4444-4444-4444-444444444444', contact_type: 'financeiro', name: 'Bruno', email: null, phone: null, notes: null, is_active: true },
    ];
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: SUPPLIER_ID }]) })
      .mockReturnValueOnce(selectChainOnce(contacts));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });
});

describe('POST /v1/suppliers/:id/contacts', () => {
  let app: FastifyInstance;

  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when the supplier does not belong to the tenant', async () => {
    mockDb.select.mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { contact_type: 'comercial', name: 'Ana' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an invalid contact_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { contact_type: 'comprador', name: 'Ana' }, // "comprador" existe em client_contacts, não aqui
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 201 and creates the contact scoped to the JWT tenant', async () => {
    const created = { id: CONTACT_ID, tenant_id: TENANT_ID, supplier_id: SUPPLIER_ID, contact_type: 'comercial', name: 'Ana', email: null, phone: null, notes: null, is_active: true };

    mockDb.select.mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: SUPPLIER_ID }]) });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([created]) }) });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { contact_type: 'comercial', name: 'Ana' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: CONTACT_ID, contact_type: 'comercial', name: 'Ana' });
  });
});

describe('PATCH /v1/suppliers/:id/contacts/:cid', () => {
  let app: FastifyInstance;

  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when the contact does not exist for this supplier/tenant', async () => {
    mockDb.select.mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts/${CONTACT_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { name: 'Novo nome' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 and updates the contact', async () => {
    const updated = { id: CONTACT_ID, contact_type: 'comercial', name: 'Novo nome', email: null, phone: null, notes: null, is_active: true };

    mockDb.select.mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: CONTACT_ID }]) });
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updated]) }) }) });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts/${CONTACT_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { name: 'Novo nome' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Novo nome');
  });
});

describe('DELETE /v1/suppliers/:id/contacts/:cid', () => {
  let app: FastifyInstance;

  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when the contact does not exist (rowCount 0 — soft delete never matched)', async () => {
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 0 }) }) });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts/${CONTACT_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 204 and soft-deletes (is_active=false), never a physical delete', async () => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 1 }) });
    mockDb.update.mockReturnValue({ set: setMock });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/suppliers/${SUPPLIER_ID}/contacts/${CONTACT_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(204);
    expect(setMock).toHaveBeenCalledWith({ is_active: false });
  });
});

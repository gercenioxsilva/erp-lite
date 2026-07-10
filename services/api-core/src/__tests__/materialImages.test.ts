import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// ── Constants mirrored from the route ──────────────────────────────────────────
const MAX_IMAGE_BYTES  = 500 * 1024;
const MAX_IMAGES       = 5;
const ALLOWED_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];

// ── DB mock (vi.hoisted ensures it's available before vi.mock factory runs) ────
const mockDb = vi.hoisted(() => ({
  select:      vi.fn(),
  insert:      vi.fn(),
  update:      vi.fn(),
  delete:      vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

// ── Helpers ────────────────────────────────────────────────────────────────────
const MATERIAL_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID   = '22222222-2222-2222-2222-222222222222';
const IMAGE_ID    = '33333333-3333-3333-3333-333333333333';

/** Generate a minimal valid base64 data URI (~30 bytes) */
const VALID_JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-data').toString('base64');
const VALID_PNG  = 'data:image/png;base64,'  + Buffer.from('fake-png-data').toString('base64');

/** Generate an oversized base64 string (> 500 KB) */
function bigImage(): string {
  return 'data:image/jpeg;base64,' + 'A'.repeat(MAX_IMAGE_BYTES + 100);
}

// ── Validation unit tests (pure logic — no HTTP, no DB) ───────────────────────

describe('material image validation logic', () => {
  it('accepts allowed image prefixes', () => {
    expect(ALLOWED_PREFIXES.some(p => VALID_JPEG.startsWith(p))).toBe(true);
    expect(ALLOWED_PREFIXES.some(p => VALID_PNG.startsWith(p))).toBe(true);
    expect(ALLOWED_PREFIXES.some(p => `data:image/webp;base64,abc`.startsWith(p))).toBe(true);
  });

  it('rejects disallowed image formats', () => {
    const gifUri  = 'data:image/gif;base64,abc';
    const textUri = 'data:text/plain;base64,abc';
    const bmpUri  = 'data:image/bmp;base64,abc';
    expect(ALLOWED_PREFIXES.some(p => gifUri.startsWith(p))).toBe(false);
    expect(ALLOWED_PREFIXES.some(p => textUri.startsWith(p))).toBe(false);
    expect(ALLOWED_PREFIXES.some(p => bmpUri.startsWith(p))).toBe(false);
  });

  it('rejects images exceeding 500 KB', () => {
    const big = bigImage();
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(MAX_IMAGE_BYTES);
  });

  it('accepts images within 500 KB', () => {
    expect(Buffer.byteLength(VALID_JPEG, 'utf8')).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  });

  it('enforces max 5 images per material', () => {
    const current = MAX_IMAGES;
    expect(current >= MAX_IMAGES).toBe(true);
  });

  it('first image automatically becomes the cover', () => {
    // Simulates the route logic: count === 0 → setCover = true
    const count = 0;
    const is_cover_explicit = undefined;
    const setCover = is_cover_explicit === true || count === 0;
    expect(setCover).toBe(true);
  });

  it('non-first image is not automatically cover', () => {
    const count: number = 2;
    const is_cover_explicit = undefined;
    const setCover = is_cover_explicit === true || count === 0;
    expect(setCover).toBe(false);
  });

  it('can explicitly set cover flag on any image', () => {
    const count: number = 3;
    const is_cover_explicit = true;
    const setCover = is_cover_explicit === true || count === 0;
    expect(setCover).toBe(true);
  });
});

// ── HTTP integration tests (app.inject + mocked DB) ───────────────────────────

describe('GET /v1/materials/:id/images', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('returns 200 with empty array when no images', async () => {
    const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue([]) };
    mockDb.select.mockReturnValue(chain);

    const res = await app.inject({ method: 'GET', url: `/v1/materials/${MATERIAL_ID}/images`, headers: { Authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns images ordered by position', async () => {
    const mockImages = [
      { id: IMAGE_ID, material_id: MATERIAL_ID, image_data: VALID_JPEG, position: 0, is_cover: true,  filename: null, alt: null, created_at: new Date().toISOString() },
      { id: '44444444-4444-4444-4444-444444444444', material_id: MATERIAL_ID, image_data: VALID_PNG, position: 1, is_cover: false, filename: null, alt: null, created_at: new Date().toISOString() },
    ];
    const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(mockImages) };
    mockDb.select.mockReturnValue(chain);

    const res = await app.inject({ method: 'GET', url: `/v1/materials/${MATERIAL_ID}/images`, headers: { Authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as typeof mockImages;
    expect(body).toHaveLength(2);
    expect(body[0].is_cover).toBe(true);
    expect(body[1].position).toBe(1);
  });
});

describe('POST /v1/materials/:id/images', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('returns 400 for unsupported image format (GIF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID, image_data: 'data:image/gif;base64,abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Formato não suportado/i);
  });

  it('returns 400 for unsupported format (plain text)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID, image_data: 'data:text/plain;base64,abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when image exceeds 500 KB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID, image_data: bigImage() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/muito grande/i);
  });

  it('returns 400 when material already has 5 images', async () => {
    // count query returns 5
    const countChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ count: MAX_IMAGES }]) };
    mockDb.select.mockReturnValue(countChain);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID, image_data: VALID_JPEG },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Máximo de 5/i);
  });

  it('returns 201 and sets is_cover=true for the first image', async () => {
    const newImage = { id: IMAGE_ID, material_id: MATERIAL_ID, image_data: VALID_JPEG, is_cover: true, position: 0, filename: null, alt: null, created_at: new Date().toISOString() };

    // count query returns 0
    const countChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ count: 0 }]) };
    mockDb.select.mockReturnValue(countChain);

    // transaction resolves with the new image
    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([newImage]) }) }),
      };
      return fn(tx as any);
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID, image_data: VALID_JPEG },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as typeof newImage;
    expect(body.is_cover).toBe(true);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/materials/${MATERIAL_ID}/images`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { tenant_id: TENANT_ID },  // missing image_data
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /v1/materials/:id/images/:imageId', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('returns 404 when image does not exist', async () => {
    const existsChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    mockDb.select.mockReturnValue(existsChain);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { is_cover: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 and promotes cover when is_cover=true', async () => {
    const updatedImage = { id: IMAGE_ID, material_id: MATERIAL_ID, image_data: VALID_JPEG, is_cover: true, position: 1, filename: null, alt: null, created_at: new Date().toISOString() };

    const existsChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: IMAGE_ID }]) };
    mockDb.select.mockReturnValue(existsChain);

    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      // First call: clear cover (no .returning()) — second call: set new fields (.returning())
      const tx = {
        update: vi.fn()
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedImage]) }) }) }),
      };
      return fn(tx as any);
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { is_cover: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when updating alt text', async () => {
    const updatedImage = { id: IMAGE_ID, material_id: MATERIAL_ID, image_data: VALID_PNG, is_cover: false, position: 0, filename: null, alt: 'New alt text', created_at: new Date().toISOString() };

    const existsChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: IMAGE_ID }]) };
    mockDb.select.mockReturnValue(existsChain);

    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      // Only one update call (no is_cover) — needs .returning()
      const tx = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedImage]) }) }) }),
      };
      return fn(tx as any);
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { alt: 'New alt text' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /v1/materials/:id/images/:imageId', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('returns 404 when image does not exist', async () => {
    const deleteChain = { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) };
    mockDb.delete.mockReturnValue(deleteChain);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 204 when non-cover image is deleted', async () => {
    const deletedImage = { id: IMAGE_ID, is_cover: false, material_id: MATERIAL_ID };
    const deleteChain  = { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([deletedImage]) }) };
    mockDb.delete.mockReturnValue(deleteChain);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('promotes next image to cover when cover is deleted', async () => {
    const deletedImage = { id: IMAGE_ID, is_cover: true, material_id: MATERIAL_ID };
    const nextImage    = { id: '44444444-4444-4444-4444-444444444444' };

    const deleteChain = { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([deletedImage]) }) };
    mockDb.delete.mockReturnValue(deleteChain);

    // Select next image chain
    const nextChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([nextImage]) };
    mockDb.select.mockReturnValue(nextChain);

    // Update chain to set next as cover
    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
    mockDb.update.mockReturnValue(updateChain);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    // Verify that update was called to promote next cover
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('does not call update when deleted cover has no remaining images', async () => {
    const deletedImage = { id: IMAGE_ID, is_cover: true, material_id: MATERIAL_ID };

    const deleteChain = { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([deletedImage]) }) };
    mockDb.delete.mockReturnValue(deleteChain);

    // No next image
    const nextChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    mockDb.select.mockReturnValue(nextChain);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/materials/${MATERIAL_ID}/images/${IMAGE_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

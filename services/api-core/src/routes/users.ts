import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';

export const usersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/users?tenant_id=&search=&page=&per_page= ──────────────── */
  fastify.get('/users', async (request, reply) => {
    const { tenant_id, search, page = '1', per_page = '20' } = request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const params: unknown[] = [tenant_id];
    let whereExtra = '';
    if (search) {
      params.push(`%${search}%`);
      whereExtra = ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      pool.query(
        `SELECT id, email, name, role, status, created_at FROM users
         WHERE tenant_id = $1${whereExtra}
         ORDER BY name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) FROM users WHERE tenant_id = $1${whereExtra}`,
        params,
      ),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/users ─────────────────────────────────────────────────── */
  fastify.post('/users', {
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'email', 'password', 'role'],
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          email:     { type: 'string', format: 'email' },
          name:      { type: 'string', maxLength: 255 },
          password:  { type: 'string', minLength: 8 },
          role:      { type: 'string', enum: ['owner', 'admin', 'manager', 'user'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenant_id, email, name, password, role } = request.body as {
      tenant_id: string; email: string; name?: string; password: string; role: string;
    };

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name?.trim() || email.split('@')[0];

    try {
      const { rows: [user] } = await pool.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, email, name, role, status, created_at`,
        [tenant_id, email, displayName, passwordHash, role],
      );
      return reply.code(201).send(user);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505')
        return reply.conflict('E-mail já cadastrado neste tenant');
      throw err;
    }
  });

  /* ── PATCH /v1/users/:id ────────────────────────────────────────────── */
  fastify.patch('/users/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:     { type: 'string', maxLength: 255 },
          role:     { type: 'string', enum: ['owner', 'admin', 'manager', 'user'] },
          status:   { type: 'string', enum: ['active', 'disabled'] },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as {
      name?: string; role?: string; status?: string; password?: string;
    };

    const { rows: [existing] } = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (!existing) return reply.notFound('Usuário não encontrado');

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (b.name     !== undefined) { sets.push(`name = $${i++}`);          vals.push(b.name);  }
    if (b.role     !== undefined) { sets.push(`role = $${i++}`);          vals.push(b.role);  }
    if (b.status   !== undefined) { sets.push(`status = $${i++}`);        vals.push(b.status); }
    if (b.password !== undefined) {
      const hash = await bcrypt.hash(b.password, 12);
      sets.push(`password_hash = $${i++}`);
      vals.push(hash);
    }

    if (!sets.length) return reply.badRequest('Nenhum campo para atualizar');

    vals.push(id);
    const { rows: [updated] } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, email, name, role, status`,
      vals,
    );
    return updated;
  });

  /* ── DELETE /v1/users/:id  (soft-delete) ───────────────────────────── */
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rowCount } = await pool.query(
      `UPDATE users SET status = 'disabled' WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rowCount) return reply.notFound('Usuário não encontrado ou já desabilitado');
    return reply.code(204).send();
  });
};

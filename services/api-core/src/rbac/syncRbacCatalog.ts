// ── Seed idempotente do RBAC no boot ────────────────────────────────────────
// Mantém o banco alinhado ao catálogo em código: upserta as permissões e os 5
// papéis de sistema (+ seus vínculos). Roda no onReady da API. Um advisory lock
// transacional serializa instâncias concorrentes (ECS multi-task) — o segundo a
// entrar encontra tudo já sincronizado (no-op). NÃO toca em papéis custom.

import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { PERMISSION_CATALOG } from './permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from './roleMatrix';
import { invalidatePermissionCache } from './permissionService';

export type DrizzleDB = typeof _db;

// Chave arbitrária p/ pg_advisory_xact_lock — só precisa ser estável e única.
const ADVISORY_LOCK_KEY = 559871023;

export async function syncRbacCatalog(db: DrizzleDB = _db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

    // 1) Catálogo de permissões (upsert — não remove chaves fora da lista).
    for (const p of PERMISSION_CATALOG) {
      await tx.execute(sql`
        INSERT INTO permissions (key, module, action, description)
        VALUES (${p.key}, ${p.module}, ${p.action}, ${p.description})
        ON CONFLICT (key) DO UPDATE
          SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description
      `);
    }

    // 2) Papéis de sistema + vínculos (substitui p/ refletir exatamente o código).
    for (const role of SYSTEM_ROLES) {
      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id FROM roles WHERE key = ${role.key} AND tenant_id IS NULL LIMIT 1
      `);

      let roleId: string;
      if (existing.rows.length) {
        roleId = existing.rows[0].id;
        await tx.execute(sql`
          UPDATE roles
          SET name = ${role.name}, description = ${role.description},
              is_system = TRUE, updated_at = NOW()
          WHERE id = ${roleId}
        `);
      } else {
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO roles (tenant_id, key, name, description, is_system)
          VALUES (NULL, ${role.key}, ${role.name}, ${role.description}, TRUE)
          RETURNING id
        `);
        roleId = inserted.rows[0].id;
      }

      await tx.execute(sql`DELETE FROM role_permissions WHERE role_id = ${roleId}`);
      for (const permKey of SYSTEM_ROLE_PERMISSIONS[role.key] ?? []) {
        await tx.execute(sql`
          INSERT INTO role_permissions (role_id, permission_key)
          VALUES (${roleId}, ${permKey})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  });

  invalidatePermissionCache(); // papéis de sistema podem ter mudado neste deploy
}

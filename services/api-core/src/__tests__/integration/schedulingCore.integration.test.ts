// ── Prova em Postgres REAL das garantias de concorrência do agendamento ──────
//
// O db mockado dos testes de service nunca vai surfacear um 23P01 (exclusion
// violation) nem serializar duas transações de verdade — exatamente os dois
// mecanismos que sustentam as regras críticas nº 4 (conflito atômico com a
// gravação) e nº 5 (conclusão + débito atômicos, saldo nunca negativo).
// Aqui rodamos os services reais (import de '../../db', que usa DATABASE_URL)
// em corridas com Promise.allSettled e batemos nos backstops físicos da
// migration 0060 (EXCLUDE, CHECK de saldo, UNIQUE de idempotência) via SQL cru.
//
// Requer Postgres com migrations aplicadas (docker-compose local usa a porta
// 5433 — exporte DATABASE_URL; o CI usa postgres:16 + migrate:dev antes).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import {
  createSession, completeSession, approveSession, cancelSession, getSessionOrThrow,
} from '../../services/schedulingSessionService';
import { SchedulingDomainError } from '../../domain/scheduling/schedulingDomain';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://erp_lite:erp_lite@localhost:5432/erp_lite';

const pool = new Pool({ connectionString: DATABASE_URL });

const DATE = '2026-08-17'; // segunda-feira, futuro fixo

interface Fixture {
  tenantId: string;
  profId:   string;
  carroId:  string;
  motoId:   string;
  clientId: string;
}

async function createFixture(): Promise<Fixture> {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (company_name, tax_id, tax_id_type)
     VALUES ($1, $2, 'CNPJ') RETURNING id`,
    [`Scheduling Test ${randomUUID()}`, randomUUID().replace(/-/g, '').slice(0, 14)],
  );
  const tenantId = tenant.id;

  const { rows: [prof] } = await pool.query(
    `INSERT INTO scheduling_professionals (tenant_id, name) VALUES ($1, 'Instrutor A') RETURNING id`,
    [tenantId],
  );
  const { rows: [carro] } = await pool.query(
    `INSERT INTO scheduling_areas (tenant_id, name, default_duration_minutes)
     VALUES ($1, 'Carro', 60) RETURNING id`,
    [tenantId],
  );
  const { rows: [moto] } = await pool.query(
    `INSERT INTO scheduling_areas (tenant_id, name, default_duration_minutes)
     VALUES ($1, 'Moto', 60) RETURNING id`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO scheduling_professional_areas (tenant_id, professional_id, area_id)
     VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, prof.id, carro.id, moto.id],
  );
  const { rows: [client] } = await pool.query(
    `INSERT INTO clients (tenant_id, person_type, full_name)
     VALUES ($1, 'PF', 'Aluno Teste') RETURNING id`,
    [tenantId],
  );

  return { tenantId, profId: prof.id, carroId: carro.id, motoId: moto.id, clientId: client.id };
}

function sessionArgs(f: Fixture, start: string, areaId?: string) {
  return {
    tenantId: f.tenantId, professionalId: f.profId, clientId: f.clientId,
    areaId: areaId ?? f.carroId, date: DATE, startTime: start,
  };
}

let f: Fixture;

beforeAll(async () => {
  await pool.query('SELECT 1'); // falha cedo e claro se o Postgres não responde
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  f = await createFixture();
});

afterEach(async () => {
  // FKs do módulo são NO ACTION/CASCADE de propósito para o cascade do tenant
  // funcionar em um único statement (RESTRICT dispararia no meio do cascade).
  await pool.query('DELETE FROM tenants WHERE id = $1', [f.tenantId]);
});

describe('conflito atômico (regra nº 4) — corridas reais', () => {
  it('duas criações concorrentes do MESMO slot: exatamente uma vence', async () => {
    const results = await Promise.allSettled([
      createSession(sessionArgs(f, '09:00')),
      createSession(sessionArgs(f, '09:00')),
    ]);

    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as SchedulingDomainError).code).toBe('session_conflict');
  });

  it('mesmo profissional, áreas diferentes, mesmo horário: ambas passam (carro×moto)', async () => {
    const results = await Promise.allSettled([
      createSession(sessionArgs(f, '09:00', f.carroId)),
      createSession(sessionArgs(f, '09:00', f.motoId)),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });

  it('meio-aberto: 08:00–09:00 e 09:00–10:00 coexistem na mesma faixa', async () => {
    await createSession(sessionArgs(f, '08:00'));
    await expect(createSession(sessionArgs(f, '09:00'))).resolves.toBeDefined();
  });

  it('cancelar libera o horário (soft-cancel auditado, regra nº 6)', async () => {
    const s = await createSession(sessionArgs(f, '09:00'));
    await expect(createSession(sessionArgs(f, '09:00'))).rejects.toMatchObject({ code: 'session_conflict' });
    await cancelSession(s.id, f.tenantId, { byUserId: null, reason: 'imprevisto' });
    await expect(createSession(sessionArgs(f, '09:00'))).resolves.toBeDefined();
  });

  it('pendente SEGURA o horário como confirmada (regra nº 3)', async () => {
    await pool.query(
      `INSERT INTO scheduling_sessions
         (tenant_id, professional_id, client_id, client_name, area_id, date, start_time, end_time, status, requested_by)
       VALUES ($1, $2, $3, 'Aluno Teste', $4, $5, '09:00', '10:00', 'pending', 'client')`,
      [f.tenantId, f.profId, f.clientId, f.carroId, DATE],
    );
    await expect(createSession(sessionArgs(f, '09:30'))).rejects.toMatchObject({ code: 'session_conflict' });
  });

  it('aprovação confirma o pending (re-checagem passa quando a agenda segue livre)', async () => {
    const { rows: [pending] } = await pool.query(
      `INSERT INTO scheduling_sessions
         (tenant_id, professional_id, client_id, client_name, area_id, date, start_time, end_time, status, requested_by)
       VALUES ($1, $2, $3, 'Aluno Teste', $4, $5, '11:00', '12:00', 'pending', 'client')
       RETURNING id`,
      [f.tenantId, f.profId, f.clientId, f.carroId, DATE],
    );
    const approved = await approveSession(pending.id, f.tenantId);
    expect(approved.status).toBe('confirmed');
  });

  it('backstop físico: INSERT cru sobreposto morre no EXCLUDE com 23P01', async () => {
    await createSession(sessionArgs(f, '09:00'));
    await expect(pool.query(
      `INSERT INTO scheduling_sessions
         (tenant_id, professional_id, client_id, client_name, area_id, date, start_time, end_time, status)
       VALUES ($1, $2, $3, 'Bypass', $4, $5, '09:30', '10:30', 'confirmed')`,
      [f.tenantId, f.profId, f.clientId, f.carroId, DATE],
    )).rejects.toMatchObject({ code: '23P01' });
  });
});

describe('conclusão atômica + débito (regra nº 5) — corridas reais', () => {
  async function grantRawPackage(totalSessions: number): Promise<string> {
    const { rows: [pkg] } = await pool.query(
      `INSERT INTO scheduling_client_packages (tenant_id, client_id, name, total_sessions)
       VALUES ($1, $2, 'Pacote Teste', $3) RETURNING id`,
      [f.tenantId, f.clientId, totalSessions],
    );
    return pkg.id;
  }

  it('duas conclusões concorrentes contra saldo 1: uma debita, a outra falha — saldo nunca negativo', async () => {
    const pkgId = await grantRawPackage(1);
    const s1 = await createSession({ ...sessionArgs(f, '09:00'), packageId: pkgId });
    const s2 = await createSession({ ...sessionArgs(f, '10:00'), packageId: pkgId });

    const results = await Promise.allSettled([
      completeSession(s1.id, f.tenantId, null),
      completeSession(s2.id, f.tenantId, null),
    ]);

    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as SchedulingDomainError).code).toBe('package_no_balance');

    const { rows: [pkg] } = await pool.query(
      'SELECT used_sessions, total_sessions, status FROM scheduling_client_packages WHERE id = $1', [pkgId]);
    expect(pkg.used_sessions).toBe(1);           // debitou exatamente 1
    expect(pkg.status).toBe('exhausted');        // saldo zerado ⇒ exhausted

    const { rows: movements } = await pool.query(
      'SELECT direction, quantity, balance_after FROM scheduling_package_movements WHERE package_id = $1', [pkgId]);
    expect(movements).toHaveLength(1);           // trilha reflete UM débito
    expect(movements[0]).toMatchObject({ direction: 'debit', quantity: 1, balance_after: 0 });
  });

  it('concluir duas vezes a mesma sessão falha (completed é imutável)', async () => {
    const pkgId = await grantRawPackage(5);
    const s = await createSession({ ...sessionArgs(f, '09:00'), packageId: pkgId });
    await completeSession(s.id, f.tenantId, null);
    await expect(completeSession(s.id, f.tenantId, null))
      .rejects.toMatchObject({ code: 'session_not_completable' });
  });

  it('backstop físico do saldo: UPDATE cru used > total morre no CHECK com 23514', async () => {
    const pkgId = await grantRawPackage(2);
    await expect(pool.query(
      'UPDATE scheduling_client_packages SET used_sessions = 3 WHERE id = $1', [pkgId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('backstop físico da idempotência: movimento duplicado morre no UNIQUE com 23505', async () => {
    const pkgId = await grantRawPackage(5);
    const insert = () => pool.query(
      `INSERT INTO scheduling_package_movements
         (tenant_id, package_id, direction, quantity, balance_after, reason, idempotency_key)
       VALUES ($1, $2, 'debit', 1, 4, 'session_completed', 'session_completed:dup-test')`,
      [f.tenantId, pkgId],
    );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
  });
});

describe('isolamento entre tenants (regra nº 8) — enforçado no backend', () => {
  it('tenant B não enxerga nem opera sessões do tenant A', async () => {
    const s = await createSession(sessionArgs(f, '09:00'));
    const other = await createFixture();
    try {
      await expect(getSessionOrThrow(s.id, other.tenantId))
        .rejects.toMatchObject({ code: 'session_not_found' });
      await expect(completeSession(s.id, other.tenantId, null))
        .rejects.toMatchObject({ code: 'session_not_found' });
      await expect(approveSession(s.id, other.tenantId))
        .rejects.toMatchObject({ code: 'session_not_found' });
    } finally {
      await pool.query('DELETE FROM tenants WHERE id = $1', [other.tenantId]);
    }
  });
});

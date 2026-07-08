// Application Service — NF-e de Simples Remessa (regra 51).
// Orquestra I/O + transação: cria a remessa, emite via Focus (mesma fila de
// NF-e/NFS-e, discriminada por type='remessa'), registra retorno e move
// estoque na autorização — nunca gera receivable nem comissão (não é venda).
// Segue o mesmo padrão de injeção de db para testabilidade isolada já usado
// em supplierInvoiceService.ts/serviceOrderBillingService.ts.

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { sql, eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { simplesRemessas, simplesRemessaItems, inventory, inventoryMovements } from '../db/schema';
import {
  assertRemessaTransition,
  validateSimplesRemessaCreate,
  calcRemessaTotals,
  resolveRemessaOperation,
  resolveRetornoOperation,
  resolveTaxSituation,
  SimplesRemessaDomainError,
  type SimplesRemessaStatus,
  type SimplesRemessaMotivo,
} from '../domain/simplesRemessa/simplesRemessaDomain';
import { resolveCompanyId, CompanyDomainError } from './companyService';
import { getIbsCbsRates } from '../lib/taxRulesResolver';
import { getSqsClient } from '../lib/sqsClient';

export type DrizzleDB = typeof _db;
export { SimplesRemessaDomainError };

export type SRItemInput = {
  materialId?: string | null;
  name:        string;
  ncmCode?:    string | null;
  quantity:    number;
  unit_price:  number;
};

export type SRCreate = {
  tenantId:   string;
  companyId?: string | null;
  clientId:   string;
  motivo:     string;
  notes?:     string | null;
  createdBy?: string | null;
  items:      SRItemInput[];
};

async function resolveCfgOrThrow(tenantId: string, companyId: string | null | undefined, db: DrizzleDB) {
  try {
    return await resolveCompanyId(tenantId, companyId ?? null, db);
  } catch (err) {
    if (err instanceof CompanyDomainError) {
      throw new SimplesRemessaDomainError('remessa_sem_empresa_configurada');
    }
    throw err;
  }
}

export async function createSimplesRemessa(args: SRCreate, db: DrizzleDB = _db) {
  validateSimplesRemessaCreate({
    motivo: args.motivo,
    items:  args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })),
  });
  const motivo = args.motivo as SimplesRemessaMotivo;

  const cfg = await resolveCfgOrThrow(args.tenantId, args.companyId, db);

  const { rows: [client] } = await db.execute<{ state: string | null }>(
    sql`SELECT state FROM clients WHERE id = ${args.clientId} AND tenant_id = ${args.tenantId}`,
  );
  if (!client) throw new SimplesRemessaDomainError('remessa_cliente_nao_encontrado', { clientId: args.clientId });

  const sameState = cfg.uf === (client.state ?? cfg.uf);
  const op = resolveRemessaOperation(motivo, sameState);
  const { subtotal, total } = calcRemessaTotals(args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })));

  return db.transaction(async (tx) => {
    const [sr] = await tx.insert(simplesRemessas).values({
      tenant_id:         args.tenantId,
      company_id:        cfg.id,
      client_id:         args.clientId,
      motivo,
      cfop:              op.cfop,
      natureza_operacao: op.natureza_operacao,
      status:            'draft',
      subtotal:          String(subtotal),
      total:             String(total),
      notes:             args.notes || null,
      created_by:        args.createdBy || null,
    }).returning();

    for (const it of args.items) {
      await tx.insert(simplesRemessaItems).values({
        simples_remessa_id: sr.id,
        material_id: it.materialId || null,
        name:        it.name,
        ncm_code:    it.ncmCode || null,
        cfop:        op.cfop,
        quantity:    String(it.quantity),
        unit_price:  String(it.unit_price),
        total:       String(Math.round(it.quantity * it.unit_price * 100) / 100),
      });
    }

    return sr;
  });
}

export async function emitSimplesRemessa(id: string, tenantId: string, db: DrizzleDB = _db) {
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  if (!queueUrl) throw new SimplesRemessaDomainError('remessa_emissao_nao_configurada');

  const [{ rows: [sr] }, { rows: items }] = await Promise.all([
    db.execute<any>(sql`
      SELECT sr.*, c.person_type, c.company_name, c.full_name, c.cnpj AS client_cnpj, c.cpf AS client_cpf,
             c.icms_taxpayer, c.zip_code, c.street, c.street_number, c.complement, c.neighborhood, c.city,
             c.state AS client_state, c.phone, c.email AS client_email
      FROM simples_remessas sr JOIN clients c ON c.id = sr.client_id
      WHERE sr.id = ${id} AND sr.tenant_id = ${tenantId}
    `),
    db.execute<any>(sql`SELECT * FROM simples_remessa_items WHERE simples_remessa_id = ${id} ORDER BY created_at`),
  ]);
  if (!sr) throw new SimplesRemessaDomainError('remessa_not_found', { id });

  assertRemessaTransition(sr.status as SimplesRemessaStatus, 'pending');
  if (!items.length) throw new SimplesRemessaDomainError('remessa_sem_itens');

  const noNcm = items.filter((it: any) => !it.ncm_code);
  if (noNcm.length) {
    throw new SimplesRemessaDomainError('remessa_item_sem_ncm', { items: noNcm.map((it: any) => it.name) });
  }

  const cfg = await resolveCfgOrThrow(tenantId, sr.company_id, db);
  if (cfg.focus_ambiente === 1 && !cfg.focus_token_producao) {
    throw new SimplesRemessaDomainError('remessa_producao_sem_token');
  }

  const isSimples     = cfg.regime_tributario === 1;
  const taxSituation  = resolveTaxSituation(cfg.regime_tributario);
  // IBS é do destino, mesmo racional já usado em taxCalculationService.ts
  // (regra 44) — a alíquota reportada à Focus é sempre a real cadastrada
  // pra UF, nunca zero (ver comentário em simplesRemessaDomain.ts).
  const ibsCbs        = await getIbsCbsRates(sr.client_state ?? cfg.uf, db);
  const focusToken    = cfg.focus_ambiente === 1 ? (cfg.focus_token_producao ?? undefined) : (cfg.focus_token_homologacao ?? undefined);

  const message = {
    type:       'remessa' as const,
    remessa_id: sr.id,
    tenant_id:  tenantId,
    focus_ref:  sr.id,
    ambiente:   cfg.focus_ambiente as 1 | 2,
    focus_token: focusToken,
    emitente: {
      cnpj: cfg.cnpj, razao_social: cfg.razao_social, nome_fantasia: cfg.nome_fantasia,
      logradouro: cfg.logradouro, numero: cfg.numero, complemento: cfg.complemento,
      bairro: cfg.bairro, municipio: cfg.municipio, uf: cfg.uf, cep: cfg.cep,
      telefone: cfg.telefone, email: cfg.email,
      regime_tributario: cfg.regime_tributario as 1 | 2 | 3,
    },
    destinatario: {
      cnpj:         sr.person_type === 'PJ' ? sr.client_cnpj : undefined,
      cpf:          sr.person_type === 'PF' ? sr.client_cpf  : undefined,
      nome:         sr.person_type === 'PJ' ? sr.company_name : sr.full_name,
      indicador_ie: Number(sr.icms_taxpayer) as 1 | 2 | 9,
      logradouro:   sr.street, numero: sr.street_number, complemento: sr.complement,
      bairro:       sr.neighborhood, municipio: sr.city, uf: sr.client_state,
      cep:          sr.zip_code, telefone: sr.phone, email: sr.client_email,
    },
    natureza_operacao: sr.natureza_operacao,
    data_emissao:      new Date().toISOString(),
    itens: items.map((it: any, idx: number) => ({
      numero_item: idx + 1,
      codigo_produto: it.material_id ?? `ITEM${idx + 1}`,
      descricao: it.name, ncm: it.ncm_code, cfop: it.cfop || sr.cfop,
      unidade_comercial: 'UN',
      quantidade_comercial:     Number(it.quantity),
      valor_unitario_comercial: Number(it.unit_price),
      valor_bruto:              Number(it.total),
      // Situação tributária de operação não onerosa (regra 51) — nunca a
      // configuração de venda do material, sempre resolvida pelo domínio de
      // remessa a partir do regime tributário da empresa emitente.
      icms_cst:   isSimples ? undefined : taxSituation.icms_cst,
      icms_csosn: isSimples ? taxSituation.icms_cst : undefined,
      class_trib: taxSituation.class_trib,
      ibs_aliquota: ibsCbs.ibsRate,
      cbs_aliquota: ibsCbs.cbsRate,
      ibs_base_calculo: taxSituation.ibs_cbs_base_calculo,
    })),
    pagamentos: [{ forma_pagamento: '99', valor_pagamento: 0 }],
  };

  await db.update(simplesRemessas)
    .set({ status: 'pending', nfe_attempts: sql`nfe_attempts + 1` })
    .where(eq(simplesRemessas.id, id));

  try {
    await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
  } catch (err) {
    // Resiliência: se não conseguimos nem enfileirar, volta pro estado
    // anterior — nunca deixa a remessa "presa" em pending sem ninguém
    // processando (mesmo princípio de tolerância a falha de routes/nfe.ts).
    await db.update(simplesRemessas).set({ status: 'draft' }).where(eq(simplesRemessas.id, id));
    throw err;
  }

  await db.update(simplesRemessas).set({ status: 'processing' }).where(eq(simplesRemessas.id, id));

  return { id, status: 'processing' as const };
}

export type SRRetornoInput = {
  tenantId:   string;
  createdBy?: string | null;
  items?:     SRItemInput[]; // omitido = repete os itens da remessa original (retorno total)
};

export async function registrarRetorno(remessaId: string, args: SRRetornoInput, db: DrizzleDB = _db) {
  const { rows: [original] } = await db.execute<{
    id: string; tenant_id: string; company_id: string | null; client_id: string;
    motivo: string; status: string;
  }>(sql`SELECT id, tenant_id, company_id, client_id, motivo, status FROM simples_remessas
         WHERE id = ${remessaId} AND tenant_id = ${args.tenantId}`);
  if (!original) throw new SimplesRemessaDomainError('remessa_not_found', { id: remessaId });
  if (original.status !== 'authorized') {
    throw new SimplesRemessaDomainError('remessa_nao_autorizada_para_retorno', { status: original.status });
  }

  const motivo = original.motivo as SimplesRemessaMotivo;
  const cfg = await resolveCfgOrThrow(args.tenantId, original.company_id, db);

  const { rows: [client] } = await db.execute<{ state: string | null }>(
    sql`SELECT state FROM clients WHERE id = ${original.client_id}`,
  );
  const sameState = cfg.uf === (client?.state ?? cfg.uf);

  const retornoOp = resolveRetornoOperation(motivo, sameState);
  if (!retornoOp) throw new SimplesRemessaDomainError('remessa_motivo_sem_retorno', { motivo });

  const { rows: originalItems } = await db.execute<{
    material_id: string | null; name: string; ncm_code: string | null; quantity: string; unit_price: string;
  }>(sql`SELECT material_id, name, ncm_code, quantity, unit_price FROM simples_remessa_items WHERE simples_remessa_id = ${remessaId}`);

  const items: SRItemInput[] = args.items?.length
    ? args.items
    : originalItems.map(it => ({
        materialId: it.material_id, name: it.name, ncmCode: it.ncm_code,
        quantity: Number(it.quantity), unit_price: Number(it.unit_price),
      }));

  validateSimplesRemessaCreate({ motivo, items: items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })) });
  const { subtotal, total } = calcRemessaTotals(items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })));

  return db.transaction(async (tx) => {
    const [retorno] = await tx.insert(simplesRemessas).values({
      tenant_id:          args.tenantId,
      company_id:         cfg.id,
      client_id:          original.client_id,
      parent_remessa_id:  remessaId,
      motivo,
      cfop:               retornoOp.cfop,
      natureza_operacao:  retornoOp.natureza_operacao,
      status:             'draft',
      subtotal:           String(subtotal),
      total:              String(total),
      created_by:         args.createdBy || null,
    }).returning();

    for (const it of items) {
      await tx.insert(simplesRemessaItems).values({
        simples_remessa_id: retorno.id,
        material_id: it.materialId || null,
        name:        it.name,
        ncm_code:    it.ncmCode || null,
        cfop:        retornoOp.cfop,
        quantity:    String(it.quantity),
        unit_price:  String(it.unit_price),
        total:       String(Math.round(it.quantity * it.unit_price * 100) / 100),
      });
    }

    return retorno;
  });
}

// ── Movimentação de estoque na autorização ─────────────────────────────────────
// Baixa ao autorizar a remessa de ida ('out'); devolve ao autorizar o retorno
// ('in'). Reaproveita inventory/inventory_movements — mesma tabela genérica já
// usada em NF-e de Entrada e Ordens de Serviço, não a valoração por Centro de
// Custo (essa é específica de venda/COGS, não se aplica a operação não onerosa).
// Idempotente via simples_remessas.stock_applied_at — chamado pelo worker de
// resultados, que pode processar a mesma mensagem mais de uma vez em cenários
// de retry do SQS.
export async function applyRemessaStockMovement(
  remessaId: string, tenantId: string, direction: 'out' | 'in', db: DrizzleDB = _db,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows: [sr] } = await tx.execute<{ stock_applied_at: string | null }>(
      sql`SELECT stock_applied_at FROM simples_remessas WHERE id = ${remessaId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
    if (!sr || sr.stock_applied_at) return; // já aplicado ou não encontrado — no-op idempotente

    const { rows: items } = await tx.execute<{ material_id: string | null; quantity: string }>(
      sql`SELECT material_id, quantity FROM simples_remessa_items WHERE simples_remessa_id = ${remessaId}`,
    );

    for (const item of items) {
      if (!item.material_id) continue;

      const { rows: [inv] } = await tx.execute<{ id: string; quantity: string }>(
        sql`SELECT id, quantity FROM inventory WHERE tenant_id = ${tenantId} AND material_id = ${item.material_id} FOR UPDATE`,
      );
      if (!inv) continue;

      const qty    = Number(item.quantity);
      const before = Number(inv.quantity);
      const after  = direction === 'out' ? before - qty : before + qty;

      await tx.execute(sql`UPDATE inventory SET quantity = ${String(after)} WHERE id = ${inv.id}`);
      await tx.insert(inventoryMovements).values({
        tenant_id:       tenantId,
        material_id:     item.material_id,
        movement_type:   direction,
        quantity:        String(qty),
        quantity_before: String(before),
        quantity_after:  String(after),
        reason:          direction === 'out' ? 'Saída por Simples Remessa' : 'Retorno de Simples Remessa',
        reference_id:    remessaId,
        reference_type:  'simples_remessa',
      } as any);
    }

    await tx.update(simplesRemessas).set({ stock_applied_at: new Date() })
      .where(eq(simplesRemessas.id, remessaId));
  });
}

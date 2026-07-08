// Domínio de NF-e de Simples Remessa — regras de negócio puras, sem I/O.
// Segue o mesmo padrão de Clean Architecture já usado em
// serviceOrderDomain.ts/supplierInvoiceDomain.ts: esta camada não conhece
// Fastify, Drizzle nem qualquer detalhe de infraestrutura.
//
// ⚠️ CST/CSOSN e CFOP por motivo abaixo são os defaults de mercado mais
// usuais para operação não onerosa — precisam de validação de um contador/
// fiscal antes do primeiro uso em produção (documentado no README, regra 51).
// Nunca inferir CFOP/situação tributária a partir de NCM — mesma restrição
// já documentada para class_trib em vendas (regra 44).

export type SimplesRemessaStatus = 'draft' | 'pending' | 'processing' | 'authorized' | 'rejected' | 'cancelled';

export type SimplesRemessaMotivo =
  | 'conserto'
  | 'demonstracao'
  | 'comodato'
  | 'industrializacao'
  | 'amostra_gratis'
  | 'devolucao';

export class SimplesRemessaDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'SimplesRemessaDomainError';
  }
}

// ── State machine ─────────────────────────────────────────────────────────────
// draft → pending → processing → authorized | rejected
// draft → cancelled
// rejected → pending (reenvio, mesmo espírito de retry de invoices)
// Transições não listadas são proibidas — estado terminal (authorized/cancelled)
// nunca retrocede.

const VALID_TRANSITIONS: Record<SimplesRemessaStatus, SimplesRemessaStatus[]> = {
  draft:      ['pending', 'cancelled'],
  pending:    ['processing'],
  processing: ['authorized', 'rejected'],
  authorized: [],
  rejected:   ['pending'],
  cancelled:  [],
};

export function assertRemessaTransition(from: SimplesRemessaStatus, to: SimplesRemessaStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new SimplesRemessaDomainError('invalid_remessa_transition', {
      from, to, allowed: VALID_TRANSITIONS[from],
    });
  }
}

// ── CFOP por motivo ────────────────────────────────────────────────────────────
// intra = mesma UF (emitente == destinatário); inter = UFs diferentes.
// retornoIntra/retornoInter: CFOP do documento de retorno correspondente,
// quando o motivo tipicamente admite retorno (null = não aplicável — ex.:
// amostra grátis é doação, devolução já É o fechamento de outra operação).

interface MotivoConfig {
  cfopIntra: string;
  cfopInter: string;
  cfopRetornoIntra: string | null;
  cfopRetornoInter: string | null;
  naturezaOperacao: string;
}

const MOTIVO_CONFIG: Record<SimplesRemessaMotivo, MotivoConfig> = {
  conserto:          { cfopIntra: '5915', cfopInter: '6915', cfopRetornoIntra: '5916', cfopRetornoInter: '6916', naturezaOperacao: 'Remessa para conserto ou reparo' },
  demonstracao:      { cfopIntra: '5912', cfopInter: '6912', cfopRetornoIntra: '5913', cfopRetornoInter: '6913', naturezaOperacao: 'Remessa para demonstração' },
  comodato:          { cfopIntra: '5908', cfopInter: '6908', cfopRetornoIntra: '5909', cfopRetornoInter: '6909', naturezaOperacao: 'Remessa em comodato' },
  industrializacao:  { cfopIntra: '5901', cfopInter: '6901', cfopRetornoIntra: '5902', cfopRetornoInter: '6902', naturezaOperacao: 'Remessa para industrialização por conta de terceiros' },
  amostra_gratis:    { cfopIntra: '5910', cfopInter: '6910', cfopRetornoIntra: null,   cfopRetornoInter: null,   naturezaOperacao: 'Remessa de amostra grátis' },
  devolucao:         { cfopIntra: '5202', cfopInter: '6202', cfopRetornoIntra: null,   cfopRetornoInter: null,   naturezaOperacao: 'Devolução de mercadoria' },
};

export const SIMPLES_REMESSA_MOTIVOS = Object.keys(MOTIVO_CONFIG) as SimplesRemessaMotivo[];

export function isValidMotivo(motivo: string): motivo is SimplesRemessaMotivo {
  return motivo in MOTIVO_CONFIG;
}

/** CFOP + natureza da operação de IDA, conforme motivo e se é intra/interestadual. */
export function resolveRemessaOperation(
  motivo: SimplesRemessaMotivo, sameState: boolean,
): { cfop: string; natureza_operacao: string } {
  const cfg = MOTIVO_CONFIG[motivo];
  return { cfop: sameState ? cfg.cfopIntra : cfg.cfopInter, natureza_operacao: cfg.naturezaOperacao };
}

/**
 * Indica se o motivo admite retorno, e se sim, o CFOP correspondente.
 * `null` significa que este motivo não tem um "retorno" fiscal aplicável
 * (amostra grátis é doação; devolução já fecha outra operação).
 */
export function resolveRetornoOperation(
  motivo: SimplesRemessaMotivo, sameState: boolean,
): { cfop: string; natureza_operacao: string } | null {
  const cfg = MOTIVO_CONFIG[motivo];
  const cfop = sameState ? cfg.cfopRetornoIntra : cfg.cfopRetornoInter;
  if (!cfop) return null;
  return { cfop, natureza_operacao: `Retorno — ${cfg.naturezaOperacao.toLowerCase()}` };
}

// ── Situação tributária de operação não onerosa ────────────────────────────────
// Diferente de venda: aqui NÃO existe ICMS a destacar (operação suspensa/não
// tributada). Para IBS/CBS, a LC 214/2025 tributa "operações onerosas" — uma
// remessa sem contraprestação financeira fica fora do fato gerador — mas isso
// se expressa zerando a BASE DE CÁLCULO (ibs_cbs_base_calculo), nunca a
// ALÍQUOTA. Bug real de produção corrigido aqui: a versão anterior zerava
// `ibs_rate`/`cbs_rate` diretamente, e esse valor ia parar no campo
// `ibs_uf_aliquota`/`cbs_aliquota` do payload da Focus — a SEFAZ rejeita
// alíquota 0 como inválida ("Alíquota do IBS da UF inválida"), porque o
// campo de alíquota sempre precisa ser o percentual real cadastrado pra UF
// (regra 44, mesmo valor usado em venda via getIbsCbsRates()), independente
// da operação ser tributada ou não. A camada de serviço (I/O) é quem resolve
// a alíquota real; este domínio só decide QUE a base de cálculo é zero.

export interface RemessaTaxSituation {
  icms_cst:   string; // CST (regime normal) ou CSOSN (Simples) — mesmo campo, mesmo padrão de invoice_items.icms_cst
  class_trib: string;
  ibs_cbs_base_calculo: number;
}

export function resolveTaxSituation(regimeTributario: number): RemessaTaxSituation {
  const isSimples = regimeTributario === 1;
  return {
    // Simples Nacional: CSOSN 400 "Não tributada pelo Simples Nacional".
    // Demais regimes: CST 41 "Não tributada" — distinto de CST 40 "Isenta"
    // (conceito legal diferente; venda usa 40 hoje, remessa usa 41 aqui).
    icms_cst:   isSimples ? '400' : '41',
    class_trib: '000001',
    ibs_cbs_base_calculo: 0,
  };
}

// ── Validações de criação ──────────────────────────────────────────────────────

export interface SimplesRemessaItemInput {
  quantity:   number;
  unit_price: number;
}

export interface SimplesRemessaCreateInput {
  motivo: string;
  items:  SimplesRemessaItemInput[];
}

export function validateSimplesRemessaCreate(input: SimplesRemessaCreateInput): void {
  if (!isValidMotivo(input.motivo)) {
    throw new SimplesRemessaDomainError('remessa_motivo_invalido', { motivo: input.motivo, allowed: SIMPLES_REMESSA_MOTIVOS });
  }
  if (!input.items.length) throw new SimplesRemessaDomainError('remessa_sem_itens');
  for (const it of input.items) {
    if (it.quantity <= 0)   throw new SimplesRemessaDomainError('remessa_item_quantidade_zero');
    if (it.unit_price < 0)  throw new SimplesRemessaDomainError('remessa_item_preco_negativo');
  }
}

export function calcRemessaTotals(items: SimplesRemessaItemInput[]): { subtotal: number; total: number } {
  const subtotal = round2(items.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  return { subtotal, total: subtotal };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

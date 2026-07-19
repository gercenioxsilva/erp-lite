// SaleImporter — contrato e helpers PUROS da importação multi-fonte (0071).
// Molde conceitual do mapMlOrderToErpOrder: parse/normalize sem I/O, falham
// alto com erro tipado, nunca produzem linha órfã. Adapters: ofxImporter
// (extrato bancário) e tabularImporter (CSV/XLSX de adquirente via template).

import { createHash } from 'crypto';

export class ImportDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ImportDomainError';
  }
}

export type SourceKind = 'ofx' | 'csv' | 'xlsx';

/** Linha canônica — os 14 campos exigidos, todos opcionais (fonte pode não
 *  trazer); `raw` preserva a linha original completa (nada se perde). */
export interface NormalizedTransaction {
  source: 'bank' | 'acquirer';
  occurredAt?: Date | null;
  nsu?: string | null;
  authorizationCode?: string | null;
  acquirer?: string | null;
  cardBrand?: string | null;
  customerName?: string | null;
  customerDocument?: string | null;
  grossAmount?: number | null;
  feeAmount?: number | null;
  netAmount?: number | null;
  installments?: number | null;
  paymentMethod?: string | null;
  establishment?: string | null;
  terminalSerial?: string | null;
  // OFX:
  bankAccountRef?: string | null;
  fitid?: string | null;
  memo?: string | null;
  trnType?: string | null;
  amount?: number | null;
  raw: Record<string, unknown>;
}

export interface ImportTemplate {
  column_map: Record<string, string>; // campo canônico -> nome da coluna na fonte
  delimiter?: string | null;
  encoding?: 'utf8' | 'win1252';
  date_format?: string;      // 'DD/MM/YYYY' | 'YYYY-MM-DD'
  decimal_separator?: string;
  has_header?: boolean;
  skip_rows?: number;
  dedup_strategy?: 'auto' | 'nsu' | 'line_hash';
}

export interface ParseResult {
  rows: NormalizedTransaction[];
  warnings: string[];
}

export interface SaleImporter {
  readonly kind: SourceKind;
  sniff(buf: Buffer, filename: string): boolean;
  parse(buf: Buffer, template?: ImportTemplate | null): Promise<ParseResult>;
  dedupKey(tx: NormalizedTransaction): string;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 'R$ 1.234,56' / '1234.56' / '-50,00' → number; inválido → null. */
export function parseAmount(rawValue: unknown, decimalSeparator = ','): number | null {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : null;
  let s = String(rawValue).replace(/[R$\s]/g, '');
  if (decimalSeparator === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Datas 'DD/MM/YYYY[ HH:mm[:ss]]' ou 'YYYY-MM-DD[ HH:mm[:ss]]' → Date | null. */
export function parseDate(rawValue: unknown, format = 'DD/MM/YYYY'): Date | null {
  if (!rawValue) return null;
  if (rawValue instanceof Date) return Number.isNaN(rawValue.getTime()) ? null : rawValue;
  const s = String(rawValue).trim();
  const time = s.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  const [hh, mm, ss] = time ? [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)] : [0, 0, 0];
  let y: number, mo: number, d: number;
  if (format.startsWith('DD')) {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const date = new Date(y, mo - 1, d, hh, mm, ss);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Data OFX: 'YYYYMMDD[HHMMSS][.XXX][[-3:GMT]]' cru OU 'YYYY-MM-DD' (algumas
 *  libs já normalizam). Parse defensivo, local. */
export function parseOfxDate(rawValue: unknown): Date | null {
  if (!rawValue) return null;
  const s = String(rawValue);
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/)
    ?? s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

const DIGITS = /\D/g;

/** CPF/CNPJ: mantém só dígitos; tamanho errado → null (não inventa documento). */
export function normalizeDocument(rawValue: unknown): string | null {
  if (!rawValue) return null;
  const d = String(rawValue).replace(DIGITS, '');
  return d.length === 11 || d.length === 14 ? d : null;
}

/**
 * Chave de dedup por fonte (índice UNIQUE tenant+dedup_key):
 * - OFX: conta+FITID quando FITID confiável; senão hash composto (FITID é
 *   violado na prática por alguns bancos — vazio/duplicado/mutável).
 * - Adquirente: acquirer+NSU+dia+valor (NSU só é único por adquirente/dia);
 *   sem NSU → hash da linha canônica.
 */
export function computeDedupKey(tx: NormalizedTransaction, kind: SourceKind): string {
  if (kind === 'ofx') {
    const acct = tx.bankAccountRef ?? 'noacct';
    if (tx.fitid && tx.fitid.trim().length >= 4) return `ofx:${acct}:${tx.fitid.trim()}`;
    const day = tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : 'nodate';
    return `ofx:${acct}:h:${sha256(`${day}|${tx.amount ?? ''}|${tx.memo ?? ''}|${tx.trnType ?? ''}`)}`;
  }
  if (tx.nsu) {
    const day = tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : 'nodate';
    return `acq:${(tx.acquirer ?? 'na').toLowerCase()}:${tx.nsu}:${day}:${tx.grossAmount ?? tx.netAmount ?? ''}`;
  }
  const day = tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : 'nodate';
  return `acq:h:${sha256(`${day}|${tx.grossAmount ?? ''}|${tx.netAmount ?? ''}|${tx.cardBrand ?? ''}|${tx.installments ?? ''}|${tx.terminalSerial ?? ''}|${tx.authorizationCode ?? ''}`)}`;
}

/** Mapeia uma linha tabular (coluna→valor) para a transação canônica via template. */
export function mapTabularRow(row: Record<string, unknown>, template: ImportTemplate): NormalizedTransaction {
  const col = (field: string): unknown => {
    const name = template.column_map[field];
    return name ? row[name] : undefined;
  };
  const sep = template.decimal_separator ?? ',';
  const tx: NormalizedTransaction = {
    source: 'acquirer',
    occurredAt: parseDate(col('occurred_at'), template.date_format ?? 'DD/MM/YYYY'),
    nsu: col('nsu') ? String(col('nsu')).trim() : null,
    authorizationCode: col('authorization_code') ? String(col('authorization_code')).trim() : null,
    acquirer: col('acquirer') ? String(col('acquirer')).trim() : null,
    cardBrand: col('card_brand') ? String(col('card_brand')).trim() : null,
    customerName: col('customer_name') ? String(col('customer_name')).trim() : null,
    customerDocument: normalizeDocument(col('customer_document')),
    grossAmount: parseAmount(col('gross_amount'), sep),
    feeAmount: parseAmount(col('fee_amount'), sep),
    netAmount: parseAmount(col('net_amount'), sep),
    installments: col('installments') != null && String(col('installments')).trim() !== ''
      ? Number(String(col('installments')).replace(DIGITS, '')) || null : null,
    paymentMethod: col('payment_method') ? String(col('payment_method')).trim() : null,
    establishment: col('establishment') ? String(col('establishment')).trim() : null,
    terminalSerial: col('terminal_serial') ? String(col('terminal_serial')).trim() : null,
    raw: row,
  };
  // Linha sem NENHUM valor monetário nem data não é uma venda — falha alto.
  if (tx.grossAmount === null && tx.netAmount === null) {
    throw new ImportDomainError('row_without_amount', { row });
  }
  return tx;
}

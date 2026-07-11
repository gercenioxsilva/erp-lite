// Adapter OFX (extrato bancário BR — SGML/OFX 1.x é o dominante).
// ofx-data-extractor em modo lenient (bancos fora do padrão) + iconv-lite
// para win1252 (acentos em MEMO). FITID é a chave preferida de dedup, com
// fallback de hash (computeDedupKey) porque bancos violam a estabilidade.

import iconv from 'iconv-lite';
import { Ofx } from 'ofx-data-extractor';
import {
  SaleImporter, NormalizedTransaction, ParseResult, ImportTemplate,
  ImportDomainError, computeDedupKey, parseOfxDate, parseAmount,
} from './saleImporterDomain';

function decodeBuffer(buf: Buffer): string {
  const head = buf.subarray(0, 400).toString('latin1');
  const charsetMatch = head.match(/CHARSET:\s*(\d+)/i);
  const encodingMatch = head.match(/ENCODING:\s*([A-Z0-9-]+)/i);
  const isWin1252 = charsetMatch?.[1] === '1252'
    || (encodingMatch && encodingMatch[1].toUpperCase() !== 'UTF-8')
    || false;
  return iconv.decode(buf, isWin1252 ? 'win1252' : 'utf8');
}

type OfxTxn = Record<string, unknown>;

function extractTransactions(content: string): { txns: OfxTxn[]; accountRef: string | null } {
  const ofx = new Ofx(content);
  let txns: OfxTxn[] = [];
  try {
    const bank = ofx.getBankTransferList() as unknown;
    if (Array.isArray(bank)) txns = bank as OfxTxn[];
  } catch { /* extrato pode ser só cartão */ }
  if (txns.length === 0) {
    try {
      const card = ofx.getCreditCardTransferList() as unknown;
      if (Array.isArray(card)) txns = card as OfxTxn[];
    } catch { /* sem transações */ }
  }
  // Conta: BANKID+ACCTID quando presentes no conteúdo cru (independe da lib).
  const bankId = content.match(/<BANKID>\s*([^<\r\n]+)/i)?.[1]?.trim();
  const acctId = content.match(/<ACCTID>\s*([^<\r\n]+)/i)?.[1]?.trim();
  const accountRef = acctId ? `${bankId ?? ''}:${acctId}` : null;
  return { txns, accountRef };
}

const field = (t: OfxTxn, ...names: string[]): unknown => {
  for (const n of names) {
    if (t[n] !== undefined) return t[n];
    const upper = n.toUpperCase();
    if (t[upper] !== undefined) return t[upper];
  }
  return undefined;
};

export const ofxImporter: SaleImporter = {
  kind: 'ofx',

  sniff(buf: Buffer, filename: string): boolean {
    const head = buf.subarray(0, 400).toString('latin1');
    return /OFXHEADER|<OFX>|<\?OFX/i.test(head) || filename.toLowerCase().endsWith('.ofx');
  },

  async parse(buf: Buffer, _template?: ImportTemplate | null): Promise<ParseResult> {
    const content = decodeBuffer(buf);
    let txns: OfxTxn[]; let accountRef: string | null;
    try {
      ({ txns, accountRef } = extractTransactions(content));
    } catch (err) {
      throw new ImportDomainError('ofx_parse_failed', { message: err instanceof Error ? err.message : String(err) });
    }
    if (txns.length === 0) throw new ImportDomainError('ofx_no_transactions');

    const warnings: string[] = [];
    const rows: NormalizedTransaction[] = [];
    for (const t of txns) {
      const amount = parseAmount(field(t, 'TRNAMT', 'trnamt'), '.');
      const occurredAt = parseOfxDate(field(t, 'DTPOSTED', 'dtposted'));
      if (amount === null) { warnings.push('transacao_sem_valor_ignorada'); continue; }
      const fitidRaw = field(t, 'FITID', 'fitid');
      rows.push({
        source: 'bank',
        occurredAt,
        amount,
        fitid: fitidRaw != null ? String(fitidRaw).trim() : null,
        memo: field(t, 'MEMO', 'memo') != null ? String(field(t, 'MEMO', 'memo')) : null,
        trnType: field(t, 'TRNTYPE', 'trntype') != null ? String(field(t, 'TRNTYPE', 'trntype')) : null,
        bankAccountRef: accountRef,
        paymentMethod: 'bank',
        raw: t as Record<string, unknown>,
      });
    }
    return { rows, warnings };
  },

  dedupKey(tx: NormalizedTransaction): string {
    return computeDedupKey(tx, 'ofx');
  },
};

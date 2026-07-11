// Adapter CSV/XLSX de adquirente (maquininha) — layouts heterogêneos
// resolvidos por template de mapeamento (import_source_templates.column_map).
// csv-parse para CSV (com sniff de delimitador) e exceljs para XLSX
// (NUNCA a lib 'xlsx'/SheetJS — CVE-2023-30533/CVE-2024-22363).

import iconv from 'iconv-lite';
import { parse as parseCsvSync } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import {
  SaleImporter, NormalizedTransaction, ParseResult, ImportTemplate,
  ImportDomainError, computeDedupKey, mapTabularRow,
} from './saleImporterDomain';

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP 'PK\x03\x04'

/** Conta ocorrências de ; , e \t na amostra e escolhe o delimitador dominante. */
export function sniffDelimiter(sample: string): string {
  const counts: Array<[string, number]> = [
    [';', (sample.match(/;/g) ?? []).length],
    [',', (sample.match(/,/g) ?? []).length],
    ['\t', (sample.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

function decodeCsv(buf: Buffer, template?: ImportTemplate | null): string {
  if (template?.encoding === 'win1252') return iconv.decode(buf, 'win1252');
  // BOM UTF-8 → utf8; senão heurística: bytes >0x7F sem sequência UTF-8 válida → win1252.
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8');
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? iconv.decode(buf, 'win1252') : utf8;
}

function rowsFromCsv(buf: Buffer, template: ImportTemplate): Record<string, unknown>[] {
  const content = decodeCsv(buf, template);
  const delimiter = template.delimiter || sniffDelimiter(content.slice(0, 2000));
  const records: string[][] = parseCsvSync(content, {
    delimiter, relax_column_count: true, skip_empty_lines: true, trim: true, bom: true,
  });
  return toObjects(records, template);
}

async function rowsFromXlsx(buf: Buffer, template: ImportTemplate): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportDomainError('xlsx_no_worksheet');
  const records: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // exceljs: índice 1-based
    records.push(values.slice(1).map((v) => {
      if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result;
      if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text;
      return v;
    }));
  });
  return toObjects(records as string[][], template);
}

function toObjects(records: string[][], template: ImportTemplate): Record<string, unknown>[] {
  const skip = template.skip_rows ?? 0;
  const body = records.slice(skip);
  if (body.length === 0) throw new ImportDomainError('file_empty');
  if (template.has_header === false) {
    // Sem cabeçalho: column_map referencia índices ('0','1',...).
    return body.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v])));
  }
  const header = body[0].map((h) => String(h ?? '').trim());
  return body.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function makeImporter(kind: 'csv' | 'xlsx'): SaleImporter {
  return {
    kind,
    sniff(buf: Buffer, filename: string): boolean {
      const isZip = buf.subarray(0, 4).equals(XLSX_MAGIC);
      if (kind === 'xlsx') return isZip || /\.xlsx?$/i.test(filename);
      return !isZip && /\.(csv|txt)$/i.test(filename);
    },
    async parse(buf: Buffer, template?: ImportTemplate | null): Promise<ParseResult> {
      if (!template?.column_map || Object.keys(template.column_map).length === 0) {
        throw new ImportDomainError('template_required', {
          hint: 'CSV/Excel de adquirente exige um template de mapeamento (import_source_templates).',
        });
      }
      const objects = kind === 'csv' ? rowsFromCsv(buf, template) : await rowsFromXlsx(buf, template);
      const warnings: string[] = [];
      const rows: NormalizedTransaction[] = [];
      for (const obj of objects) {
        try {
          rows.push(mapTabularRow(obj, template));
        } catch (err) {
          if (err instanceof ImportDomainError && err.code === 'row_without_amount') {
            warnings.push('linha_sem_valor_ignorada'); continue; // rodapé/subtotal
          }
          throw err;
        }
      }
      if (rows.length === 0) throw new ImportDomainError('no_mappable_rows');
      return { rows, warnings };
    },
    dedupKey(tx: NormalizedTransaction): string {
      return computeDedupKey(tx, kind);
    },
  };
}

export const csvImporter  = makeImporter('csv');
export const xlsxImporter = makeImporter('xlsx');

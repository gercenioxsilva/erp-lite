// Registry de importadores — espelho do roteamento por body.type do
// lambda-fiscal: novas fontes (Pluggy/Open Finance…) entram aqui sem tocar
// no worker nem nas rotas.

import { SaleImporter, SourceKind, ImportDomainError } from './saleImporterDomain';
import { ofxImporter } from './ofxImporter';
import { csvImporter, xlsxImporter } from './tabularImporter';

const REGISTRY: Record<SourceKind, SaleImporter> = {
  ofx:  ofxImporter,
  csv:  csvImporter,
  xlsx: xlsxImporter,
};

export function getImporter(kind: string): SaleImporter {
  const importer = REGISTRY[kind as SourceKind];
  if (!importer) throw new ImportDomainError('unknown_source_kind', { kind });
  return importer;
}

/** Detecta o tipo de arquivo por magic bytes/conteúdo (não confia no MIME). */
export function detectSourceKind(buf: Buffer, filename: string): SourceKind {
  if (ofxImporter.sniff(buf, filename)) return 'ofx';
  if (xlsxImporter.sniff(buf, filename)) return 'xlsx';
  if (csvImporter.sniff(buf, filename)) return 'csv';
  throw new ImportDomainError('unsupported_file_type', { filename });
}

export * from './saleImporterDomain';

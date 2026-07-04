import * as XLSX from 'xlsx';

// Wrapper do padrão de export XLSX do projeto (ReportsPage:73-101), centralizado
// para não reimplementar json_to_sheet → book_append_sheet → writeFile em cada
// relatório. `rows` já deve vir com as colunas em português prontas para a planilha.

export function exportXlsx(filenamePrefix: string, sheetName: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // limite de nome de aba do Excel
  XLSX.writeFile(wb, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

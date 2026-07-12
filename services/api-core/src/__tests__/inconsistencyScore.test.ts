// E2: detector de inconsistências (dono único) + Score com carências.

import { describe, it, expect } from 'vitest';
import { runInconsistencyChecks, ChecksInput } from '../domain/fiscal/inconsistencyDomain';
import { computeFiscalScore } from '../domain/fiscal/scoreDomain';

const EMPTY: ChecksInput = {
  competencia: '2026-07', paymentsWithoutDoc: [], unpaidInvoices: [], cardVsNotes: [],
  issMismatches: [], nfseSemServiceCode: [], hasCnaePrincipal: true, configId: 'c1', dasSeries: [],
};

describe('runInconsistencyChecks', () => {
  it('sem problemas → zero findings', () => {
    expect(runInconsistencyChecks(EMPTY)).toEqual([]);
  });

  it('recebimento sem nota e nota sem recebimento (escala p/ critical em 2×N dias)', () => {
    const out = runInconsistencyChecks({
      ...EMPTY,
      paymentsWithoutDoc: [{ id: 'p1', amount: 500, paymentDate: '2026-07-02' }],
      unpaidInvoices: [
        { id: 'n1', kind: 'nfse', amount: 1000, authDate: '2026-06-01', daysOpen: 35 },
        { id: 'n2', kind: 'invoice', amount: 2000, authDate: '2026-04-01', daysOpen: 90 },
        { id: 'n3', kind: 'nfse', amount: 100, authDate: '2026-07-01', daysOpen: 10 }, // abaixo do limiar
      ],
    });
    expect(out.filter((f) => f.rule === 'payment_without_invoice')).toHaveLength(1);
    const unpaid = out.filter((f) => f.rule === 'invoice_without_payment');
    expect(unpaid).toHaveLength(2);
    expect(unpaid.find((f) => f.refs[0].id === 'n2')?.severity).toBe('critical');
  });

  it('maquininha × notas: dentro da tolerância não alerta; >20% vira critical', () => {
    const out = runInconsistencyChecks({
      ...EMPTY,
      cardVsNotes: [
        { competencia: '2026-06', cardRevenue: 10_000, notesRevenue: 9_800 },  // 2% ok
        { competencia: '2026-07', cardRevenue: 10_000, notesRevenue: 7_000 },  // 30% critical
      ],
    });
    const mism = out.filter((f) => f.rule === 'card_revenue_mismatch');
    expect(mism).toHaveLength(1);
    expect(mism[0].severity).toBe('critical');
    expect(mism[0].competencia).toBe('2026-07');
  });

  it('média móvel do DAS exige amostra mínima (empresa nova = sem finding)', () => {
    const serie = (vals: number[]) => vals.map((v, i) => ({
      competencia: `2026-0${i + 1}`, apuracaoId: `a${i}`, dasTotal: v,
    }));
    // Só 3 pontos (2 anteriores + atual) → sem amostra suficiente.
    expect(runInconsistencyChecks({ ...EMPTY, dasSeries: serie([1000, 1100, 5000]) })).toEqual([]);
    // 4 pontos, último 5000 vs média 1000 → finding.
    const out = runInconsistencyChecks({ ...EMPTY, dasSeries: serie([1000, 1000, 1000, 5000]) });
    expect(out.filter((f) => f.rule === 'das_above_moving_avg')).toHaveLength(1);
  });

  it('CNAE ausente e NFS-e sem service_code viram findings', () => {
    const out = runInconsistencyChecks({
      ...EMPTY, hasCnaePrincipal: false, nfseSemServiceCode: [{ id: 'n9' }],
    });
    expect(out.map((f) => f.rule).sort()).toEqual(['invoice_missing_service_code', 'missing_cnae']);
  });
});

describe('computeFiscalScore (carências)', () => {
  const finding = (severity: 'critical' | 'warning' | 'info') => ({
    rule: 'payment_without_invoice' as const, severity, competencia: null, title: 'x', refs: [], payload: {},
  });

  it('empresa limpa = 100', () => {
    const r = computeFiscalScore({
      findings: [], readiness: { ready: true, reasons: [] }, reconPendingCount: 0,
      hasAnyEmission: true, hasAnyImport: true,
    });
    expect(r.score).toBe(100);
  });

  it('pesos: critical -10, warning -4, info -1; caps por categoria; floor 0', () => {
    const r = computeFiscalScore({
      findings: [finding('critical'), finding('warning'), finding('info')],
      readiness: { ready: false, reasons: ['certificate_missing', 'service_code_missing'] },
      reconPendingCount: 3, hasAnyEmission: true, hasAnyImport: true,
    });
    expect(r.score).toBe(100 - 15 - 10 - 3);
    const many = computeFiscalScore({
      findings: Array.from({ length: 20 }, () => finding('critical')),
      readiness: { ready: false, reasons: Array.from({ length: 10 }, (_, i) => `r${i}`) },
      reconPendingCount: 100, hasAnyEmission: true, hasAnyImport: true,
    });
    expect(many.score).toBe(0); // 50+25+25 capados
  });

  it('CARÊNCIA: empresa sem emissão não é punida por cadastro; sem import não é punida por conciliação', () => {
    const r = computeFiscalScore({
      findings: [], readiness: { ready: false, reasons: ['certificate_missing'] }, reconPendingCount: 50,
      hasAnyEmission: false, hasAnyImport: false,
    });
    expect(r.score).toBe(100);
  });
});

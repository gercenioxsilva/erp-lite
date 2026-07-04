import { describe, it, expect } from 'vitest';
import { buildProposalsFunnel, type ProposalRow } from '../domain/proposalsFunnel/proposalsFunnelDomain';

function row(status: string, rejected_reason: string | null = null): ProposalRow {
  return { status, rejected_reason };
}

describe('buildProposalsFunnel', () => {
  it('conta todos os estagios do funil corretamente', () => {
    const rows = [
      row('draft'), row('sent'), row('viewed'), row('accepted'), row('accepted'), row('rejected', 'preco'),
    ];
    const res = buildProposalsFunnel('2025-01-01', '2025-01-31', rows);
    expect(res.total).toBe(6);
    const byKey = Object.fromEntries(res.stages.map(s => [s.key, s]));
    expect(byKey.created.count).toBe(6);
    expect(byKey.sent_or_later.count).toBe(5); // tudo menos 'draft'
    expect(byKey.viewed_or_later.count).toBe(3); // 1 viewed + 2 accepted
    expect(byKey.accepted.count).toBe(2);
  });

  it('calcula taxa de conversao entre estagios', () => {
    const rows = [row('sent'), row('sent'), row('viewed'), row('accepted')];
    const res = buildProposalsFunnel('2025-01-01', '2025-01-31', rows);
    const byKey = Object.fromEntries(res.stages.map(s => [s.key, s]));
    expect(byKey.sent_or_later.conversion_from_previous).toBe(100); // 4/4
    expect(byKey.viewed_or_later.conversion_from_previous).toBe(50); // 2/4 (viewed+accepted) sobre sent_or_later=4
  });

  it('total=0 nao gera divisao por zero', () => {
    const res = buildProposalsFunnel('2025-01-01', '2025-01-31', []);
    expect(res.total).toBe(0);
    expect(res.acceptance_rate).toBe(0);
    expect(res.stages.every(s => s.pct_of_total === 0)).toBe(true);
  });

  it('agrupa motivos de rejeicao e agrega em Outros alem de 8 distintos', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row('rejected', `motivo-${i}`));
    const res = buildProposalsFunnel('2025-01-01', '2025-01-31', rows);
    expect(res.rejection_reasons).toHaveLength(9); // 8 distintos + "Outros" (cada motivo unico conta 1x)
    expect(res.rejection_reasons[res.rejection_reasons.length - 1].reason).toBe('Outros');
    expect(res.rejection_reasons[res.rejection_reasons.length - 1].count).toBe(1);
  });

  it('ignora rejected sem rejected_reason no agrupamento', () => {
    const res = buildProposalsFunnel('2025-01-01', '2025-01-31', [row('rejected', null)]);
    expect(res.rejection_reasons).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { buildTechnicianProductivity, type VisitInput } from '../domain/technicianProductivity/technicianProductivityDomain';

function visit(overrides: Partial<VisitInput>): VisitInput {
  return {
    technician_id: 't1', technician_name: 'Joao', status: 'completed',
    scheduled_at: '2025-01-01T10:00:00Z', checked_in_at: '2025-01-01T10:00:00Z', checked_out_at: '2025-01-01T11:00:00Z',
    ...overrides,
  };
}

describe('buildTechnicianProductivity', () => {
  it('calcula duracao media entre duas visitas completas', () => {
    const res = buildTechnicianProductivity([
      visit({ checked_in_at: '2025-01-01T10:00:00Z', checked_out_at: '2025-01-01T11:00:00Z' }), // 60min
      visit({ checked_in_at: '2025-01-01T10:00:00Z', checked_out_at: '2025-01-01T10:30:00Z' }), // 30min
    ]);
    expect(res.technicians[0].avg_duration_minutes).toBe(45);
  });

  it('calcula no_show_rate corretamente', () => {
    const res = buildTechnicianProductivity([
      visit({ status: 'completed' }), visit({ status: 'no_show' }), visit({ status: 'no_show' }), visit({ status: 'completed' }),
    ]);
    expect(res.technicians[0].no_show).toBe(2);
    expect(res.technicians[0].no_show_rate).toBe(50);
  });

  it('respeita a tolerancia de 15 minutos para on_time_rate', () => {
    const res = buildTechnicianProductivity([
      visit({ scheduled_at: '2025-01-01T10:00:00Z', checked_in_at: '2025-01-01T10:10:00Z' }), // 10min atraso: on time
      visit({ scheduled_at: '2025-01-01T10:00:00Z', checked_in_at: '2025-01-01T10:20:00Z' }), // 20min atraso: not on time
    ]);
    expect(res.technicians[0].on_time_rate).toBe(50);
  });

  it('visitas sem checked_in_at nao contam para on_time_rate', () => {
    const res = buildTechnicianProductivity([visit({ checked_in_at: null })]);
    expect(res.technicians[0].on_time_rate).toBeNull();
  });

  it('retorna avg_duration_minutes null quando nenhuma visita completa tem os dois timestamps', () => {
    const res = buildTechnicianProductivity([visit({ status: 'scheduled', checked_in_at: null, checked_out_at: null })]);
    expect(res.technicians[0].avg_duration_minutes).toBeNull();
  });

  it('ordena tecnicos por total_visits desc e soma o resumo geral', () => {
    const res = buildTechnicianProductivity([
      visit({ technician_id: 't1', technician_name: 'A' }),
      visit({ technician_id: 't2', technician_name: 'B' }), visit({ technician_id: 't2', technician_name: 'B' }), visit({ technician_id: 't2', technician_name: 'B' }),
      visit({ technician_id: 't1', technician_name: 'A', status: 'no_show' }),
    ]);
    expect(res.technicians[0].technician_id).toBe('t2');
    expect(res.summary.total_visits).toBe(5);
    expect(res.summary.total_no_show).toBe(1);
    expect(res.summary.overall_no_show_rate).toBe(20);
  });
});

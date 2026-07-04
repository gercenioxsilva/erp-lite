// Domínio de Produtividade/SLA por Técnico — agregação pura (sem I/O) de visitas.

export const ON_TIME_TOLERANCE_MINUTES = 15;

export interface VisitInput {
  technician_id: string;
  technician_name: string;
  status: string;
  scheduled_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

export interface TechnicianStats {
  technician_id: string;
  technician_name: string;
  total_visits: number;
  completed: number;
  no_show: number;
  no_show_rate: number;
  avg_duration_minutes: number | null;
  on_time_rate: number | null;
}

export interface TechnicianProductivityResult {
  technicians: TechnicianStats[];
  summary: { total_visits: number; total_no_show: number; overall_no_show_rate: number };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildTechnicianProductivity(visits: VisitInput[]): TechnicianProductivityResult {
  const byTechnician = new Map<string, { name: string; visits: VisitInput[] }>();
  for (const v of visits) {
    const entry = byTechnician.get(v.technician_id) ?? { name: v.technician_name, visits: [] };
    entry.visits.push(v);
    byTechnician.set(v.technician_id, entry);
  }

  const technicians: TechnicianStats[] = Array.from(byTechnician.entries()).map(([technician_id, { name, visits: vs }]) => {
    const total_visits = vs.length;
    const completed = vs.filter(v => v.status === 'completed').length;
    const no_show = vs.filter(v => v.status === 'no_show').length;
    const no_show_rate = total_visits > 0 ? round1((no_show / total_visits) * 100) : 0;

    const completedWithDuration = vs.filter(v => v.status === 'completed' && v.checked_in_at && v.checked_out_at);
    const avg_duration_minutes = completedWithDuration.length > 0
      ? round1(completedWithDuration.reduce((s, v) => {
          const minutes = (new Date(v.checked_out_at as string).getTime() - new Date(v.checked_in_at as string).getTime()) / 60000;
          return s + minutes;
        }, 0) / completedWithDuration.length)
      : null;

    const withCheckIn = vs.filter(v => v.checked_in_at != null);
    const onTimeCount = withCheckIn.filter(v => {
      const scheduled = new Date(v.scheduled_at).getTime();
      const checkedIn = new Date(v.checked_in_at as string).getTime();
      return checkedIn <= scheduled + ON_TIME_TOLERANCE_MINUTES * 60000;
    }).length;
    const on_time_rate = withCheckIn.length > 0 ? round1((onTimeCount / withCheckIn.length) * 100) : null;

    return { technician_id, technician_name: name, total_visits, completed, no_show, no_show_rate, avg_duration_minutes, on_time_rate };
  });

  technicians.sort((a, b) => b.total_visits - a.total_visits);

  const total_visits = visits.length;
  const total_no_show = visits.filter(v => v.status === 'no_show').length;

  return {
    technicians,
    summary: {
      total_visits,
      total_no_show,
      overall_no_show_rate: total_visits > 0 ? round1((total_no_show / total_visits) * 100) : 0,
    },
  };
}

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, BalanceBar } from '../../ds';
import type { BadgeVariant } from '../../ds';
import { todayISO, formatDateBR } from '../../lib/schedulingTime';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalPackage {
  id:                 string;
  name:               string;
  area_id:            string | null; // null = vale para qualquer área
  total_sessions:     number;
  used_sessions:      number;
  remaining_sessions: number;
  payment_status:     string;
  status:             string;
  valid_until:        string | null;
}

interface PortalArea {
  id:   string;
  name: string;
}

const PAYMENT_META: Record<string, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pendente', variant: 'pending' },
  partial: { label: 'Parcial',  variant: 'issued' },
  paid:    { label: 'Pago',     variant: 'paid' },
};

/** Badge extra só quando o pacote não está mais utilizável. */
function statusMeta(p: PortalPackage): { label: string; variant: BadgeVariant } | null {
  if (p.status === 'canceled' || p.status === 'cancelled')                return { label: 'Cancelado', variant: 'cancelled' };
  if (p.status === 'expired' || (p.valid_until !== null && p.valid_until < todayISO()))
    return { label: 'Expirado', variant: 'overdue' };
  if (p.status === 'exhausted' || p.remaining_sessions <= 0)              return { label: 'Esgotado', variant: 'inactive' };
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PortalPackagesPage() {
  const [packages, setPackages] = useState<PortalPackage[]>([]);
  const [areas,    setAreas]    = useState<PortalArea[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ data: PortalPackage[] }>('/v1/portal/packages'),
      api.get<{ data: PortalArea[] }>('/v1/portal/areas'),
    ])
      .then(([p, a]) => { if (!alive) return; setPackages(p.data); setAreas(a.data); })
      .catch(() => { if (alive) setError('Não foi possível carregar seus pacotes. Tente novamente.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const areaLabel = (id: string | null) =>
    id === null ? 'Qualquer área' : (areas.find(a => a.id === id)?.name ?? 'Área');

  return (
    <div>
      <h1 className="portal-hello">Meus pacotes</h1>
      <p className="portal-hello-sub">Saldo de sessões, pagamento e validade.</p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading ? (
        <div className="portal-card"><div className="spinner">Carregando…</div></div>
      ) : packages.length === 0 ? (
        <div className="portal-card">
          <div className="portal-empty">Você ainda não tem pacotes.</div>
        </div>
      ) : (
        <div className="portal-stack">
          {packages.map(p => {
            const payment = PAYMENT_META[p.payment_status];
            const status  = statusMeta(p);
            return (
              <div key={p.id} className="portal-card">
                <div className="portal-package__head">
                  <div>
                    <div className="portal-package__name">{p.name}</div>
                    <div className="portal-package__area">{areaLabel(p.area_id)}</div>
                  </div>
                  <div className="portal-package__badges">
                    {payment && <Badge variant={payment.variant}>{payment.label}</Badge>}
                    {status  && <Badge variant={status.variant}>{status.label}</Badge>}
                  </div>
                </div>

                <div className="portal-package__balance">
                  <BalanceBar total={p.total_sessions} used={p.used_sessions} compact />
                </div>

                <div className="portal-package__foot">
                  <span>
                    {p.used_sessions} de {p.total_sessions} {p.used_sessions === 1 ? 'usada' : 'usadas'}
                  </span>
                  <span>
                    {p.valid_until !== null ? `Válido até ${formatDateBR(p.valid_until)}` : 'Sem validade'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

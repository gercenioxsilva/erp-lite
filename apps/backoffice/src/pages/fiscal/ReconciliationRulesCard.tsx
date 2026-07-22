// Regra de conciliação do tenant (E9) — edição do que antes só existia em SQL.
// Modelo simples: uma regra-padrão do tenant (company_id null). Sem regra
// salva, valem os defaults do motor (0,01 / 3 dias / 0,90 / líquido).

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Rule {
  id: string; company_id: string | null;
  amount_tolerance: string; date_window_days: number;
  auto_confirm_threshold: string; match_net_amount: boolean;
  description_weight: string; use_ai_matching: boolean;
}

const DEFAULTS = {
  amount_tolerance: '0.01', date_window_days: 3, auto_confirm_threshold: '0.90', match_net_amount: true,
  description_weight: '0.25', use_ai_matching: false,
};

export function ReconciliationRulesCard({ canEdit }: { canEdit: boolean }) {
  const [rule, setRule] = useState<Rule | null>(null);
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ data: Rule[] }>('/v1/fiscal/reconciliation/rules')
      .then((r) => {
        const tenantRule = r.data.find((x) => x.company_id === null) ?? r.data[0] ?? null;
        setRule(tenantRule);
        if (tenantRule) {
          setForm({
            amount_tolerance: tenantRule.amount_tolerance,
            date_window_days: tenantRule.date_window_days,
            auto_confirm_threshold: tenantRule.auto_confirm_threshold,
            match_net_amount: tenantRule.match_net_amount,
            description_weight: tenantRule.description_weight ?? DEFAULTS.description_weight,
            use_ai_matching: tenantRule.use_ai_matching ?? DEFAULTS.use_ai_matching,
          });
        }
      })
      .catch(() => setRule(null));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    const body = {
      amount_tolerance: Number(form.amount_tolerance),
      date_window_days: Number(form.date_window_days),
      auto_confirm_threshold: Number(form.auto_confirm_threshold),
      match_net_amount: form.match_net_amount,
      description_weight: Number(form.description_weight),
      use_ai_matching: form.use_ai_matching,
    };
    try {
      const saved = rule
        ? await api.put<Rule>(`/v1/fiscal/reconciliation/rules/${rule.id}`, body)
        : await api.post<Rule>('/v1/fiscal/reconciliation/rules', body);
      setRule(saved);
      setMsg('Regra salva.');
    } catch {
      setMsg('Falha ao salvar.');
    } finally { setSaving(false); }
  }

  const num = (k: 'amount_tolerance' | 'auto_confirm_threshold' | 'description_weight', label: string, step: string) => (
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
      <span style={{ color: 'var(--muted, #64748b)' }}>{label}</span>
      <input type="number" step={step} value={form[k]} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }} />
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {num('amount_tolerance', 'Tolerância de valor (R$)', '0.01')}
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--muted, #64748b)' }}>Janela de data (dias)</span>
          <input type="number" step="1" value={form.date_window_days} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, date_window_days: Number(e.target.value) })}
            style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }} />
        </label>
        {num('auto_confirm_threshold', 'Auto-confirmar acima de', '0.05')}
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--muted, #64748b)' }}>Casar valor</span>
          <select value={form.match_net_amount ? 'net' : 'gross'} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, match_net_amount: e.target.value === 'net' })}
            style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }}>
            <option value="net">Líquido (depósito)</option>
            <option value="gross">Bruto (venda)</option>
          </select>
        </label>
        {num('description_weight', 'Peso da descrição (0–1)', '0.05')}
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--muted, #64748b)' }}>Casar descrição com IA</span>
          <select value={form.use_ai_matching ? 'on' : 'off'} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, use_ai_matching: e.target.value === 'on' })}
            style={{ fontSize: 13, padding: '4px 6px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6 }}>
            <option value="off">Desligado (só léxico)</option>
            <option value="on">Ligado (Claude)</option>
          </select>
        </label>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', margin: 0 }}>
        A descrição semântica ajuda a casar lançamentos sem NSU (ex.: PIX com nome do
        pagador). Com peso 0 ela é ignorada; a IA só entra se o servidor tiver chave configurada.
      </p>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar regra'}</button>
          {msg && <span style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>{msg}</span>}
        </div>
      )}
      {!rule && <p style={{ fontSize: 12, color: 'var(--muted, #94a3b8)', margin: 0 }}>Sem regra salva — vale o padrão do sistema.</p>}
    </div>
  );
}

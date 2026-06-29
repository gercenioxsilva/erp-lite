import { FormEvent } from 'react';
import { useI18n } from '../../i18n';

// ── Shared types ───────────────────────────────────────────────────────────────

export interface MaterialOption {
  id:   string;
  name: string;
  sku:  string;
}

// ── MaterialSelect ─────────────────────────────────────────────────────────────

function MaterialSelect({
  value,
  onChange,
  materials,
}: {
  value:     string;
  onChange:  (v: string) => void;
  materials: MaterialOption[];
}) {
  if (materials.length > 0) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Selecione um material…</option>
        {materials.map(m => (
          <option key={m.id} value={m.id}>
            {m.sku ? `${m.sku} — ` : ''}{m.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="ID do material (UUID)…"
    />
  );
}

// ── EditDrawer ─────────────────────────────────────────────────────────────────

interface EditForm {
  name:           string;
  description:    string;
  allow_negative: boolean;
  is_active:      boolean;
}

interface EditDrawerProps {
  open:     boolean;
  form:     EditForm;
  saving:   boolean;
  error:    string;
  onClose:  () => void;
  onChange: (f: EditForm) => void;
  onSubmit: (e: FormEvent) => void;
}

export function EditDrawer({ open, form, saving, error, onClose, onChange, onSubmit }: EditDrawerProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>Editar Centro de Custo</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={onSubmit} noValidate style={{ display: 'contents' }}>
          <div className="drawer-body">
            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <div className="field">
              <label>{t('cc.name')} *</label>
              <input
                value={form.name}
                onChange={e => onChange({ ...form, name: e.target.value })}
                placeholder="Ex.: Administração"
                required
              />
            </div>

            <div className="field">
              <label>{t('cc.description')}</label>
              <textarea
                value={form.description}
                onChange={e => onChange({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Descrição opcional…"
              />
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.allow_negative}
                  onChange={e => onChange({ ...form, allow_negative: e.target.checked })}
                  style={{ width: 'auto', margin: 0 }}
                />
                {t('cc.allowNegative')}
              </label>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => onChange({ ...form, is_active: e.target.checked })}
                  style={{ width: 'auto', margin: 0 }}
                />
                {t('c.active')}
              </label>
            </div>
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('c.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : t('c.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── EntryDrawer ────────────────────────────────────────────────────────────────

interface EntryForm {
  material_id: string;
  quantity:    string;
  unit_cost:   string;
  note:        string;
}

interface EntryDrawerProps {
  open:      boolean;
  form:      EntryForm;
  saving:    boolean;
  error:     string;
  materials: MaterialOption[];
  onClose:   () => void;
  onChange:  (f: EntryForm) => void;
  onSubmit:  (e: FormEvent) => void;
}

export function EntryDrawer({ open, form, saving, error, materials, onClose, onChange, onSubmit }: EntryDrawerProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>{t('cc.entry')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={onSubmit} noValidate style={{ display: 'contents' }}>
          <div className="drawer-body">
            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <div className="field">
              <label>Material *</label>
              <MaterialSelect
                value={form.material_id}
                onChange={v => onChange({ ...form, material_id: v })}
                materials={materials}
              />
            </div>

            <div className="field">
              <label>{t('cc.quantity')} *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.quantity}
                onChange={e => onChange({ ...form, quantity: e.target.value })}
                placeholder="Ex.: 10"
                required
              />
            </div>

            <div className="field">
              <label>{t('cc.unitCost')} *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unit_cost}
                onChange={e => onChange({ ...form, unit_cost: e.target.value })}
                placeholder="Ex.: 25.90"
                required
              />
            </div>

            <div className="field">
              <label>Nota (opcional)</label>
              <textarea
                value={form.note}
                onChange={e => onChange({ ...form, note: e.target.value })}
                rows={2}
                placeholder="Observação sobre a entrada…"
              />
            </div>
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('c.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : 'Registrar Entrada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── AdjustDrawer ───────────────────────────────────────────────────────────────

interface AdjustForm {
  material_id:     string;
  target_quantity: string;
  note:            string;
}

interface AdjustDrawerProps {
  open:      boolean;
  form:      AdjustForm;
  saving:    boolean;
  error:     string;
  materials: MaterialOption[];
  onClose:   () => void;
  onChange:  (f: AdjustForm) => void;
  onSubmit:  (e: FormEvent) => void;
}

export function AdjustDrawer({ open, form, saving, error, materials, onClose, onChange, onSubmit }: AdjustDrawerProps) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>{t('cc.adjustment')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={onSubmit} noValidate style={{ display: 'contents' }}>
          <div className="drawer-body">
            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <div className="field">
              <label>Material *</label>
              <MaterialSelect
                value={form.material_id}
                onChange={v => onChange({ ...form, material_id: v })}
                materials={materials}
              />
            </div>

            <div className="field">
              <label>Quantidade alvo *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.target_quantity}
                onChange={e => onChange({ ...form, target_quantity: e.target.value })}
                placeholder="Ex.: 50"
                required
              />
            </div>

            <div className="field">
              <label>Nota (opcional)</label>
              <textarea
                value={form.note}
                onChange={e => onChange({ ...form, note: e.target.value })}
                rows={2}
                placeholder="Motivo do ajuste…"
              />
            </div>
          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('c.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? t('c.saving') : 'Registrar Ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

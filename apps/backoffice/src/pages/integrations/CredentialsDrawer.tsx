// Edição das credenciais de um par (provider × ambiente).
//
// A API nunca devolve o valor de uma credencial — só `filled`. Por isso TODO
// campo abre vazio e a regra de envio é: vazio = mantém, `null` = limpa. Quem
// persiste é a página (onSubmit); aqui mora só o estado do formulário.

import { useState } from 'react';
import './integrations.css';
import { Drawer, Switch } from '../../ds';
import { actionErrorMessage } from '../../lib/api';
import type { PublicCredentialField, PublicProviderCard } from './types';

const KEEP_HINT = 'Já preenchido — deixe em branco para manter';

/**
 * Placeholder de campo já salvo. A API manda um rabicho mascarado (`••••a1b2`)
 * — nunca o valor — para o usuário reconhecer QUAL chave está lá antes de
 * decidir substituir. Sem rabicho (arquivo), cai no texto genérico.
 */
function keepPlaceholder(field: PublicCredentialField): string {
  return field.maskedHint
    ? `${field.maskedHint} (deixe vazio para manter)`
    : KEEP_HINT;
}

/** Arquivo → base64 PURO (o backend não espera o prefixo `data:...;base64,`). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

interface CredentialsDrawerProps {
  card: PublicProviderCard;
  /** Deve persistir e fechar o drawer; se rejeitar, o erro aparece aqui. */
  onSubmit: (credentials: Record<string, string | null>, services: string[]) => Promise<void>;
  onClose: () => void;
}

export function CredentialsDrawer({ card, onSubmit, onClose }: CredentialsDrawerProps) {
  const [values, setValues]   = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  // Estado inicial vem do card; o PUT manda sempre a lista COMPLETA do que
  // fica ligado (não é patch incremental — ver saveServices no backend).
  const [services, setServices] = useState<Record<string, boolean>>(
    () => Object.fromEntries(card.services.map(s => [s.key, s.enabled])),
  );

  function toggleService(key: string) {
    setServices(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function setValue(key: string, value: string) {
    setValues(prev => ({ ...prev, [key]: value }));
  }

  function toggleCleared(key: string) {
    setCleared(prev => ({ ...prev, [key]: !prev[key] }));
    // Um campo marcado para limpar não pode carregar valor digitado junto.
    setValues(prev => ({ ...prev, [key]: '' }));
    setFileNames(prev => ({ ...prev, [key]: '' }));
  }

  async function handleFile(field: PublicCredentialField, file: File | undefined) {
    if (!file) {
      setValue(field.key, '');
      setFileNames(prev => ({ ...prev, [field.key]: '' }));
      return;
    }
    setError('');
    try {
      setValue(field.key, await readFileAsBase64(file));
      setFileNames(prev => ({ ...prev, [field.key]: file.name }));
    } catch (err) {
      setError(actionErrorMessage(err, 'Não foi possível ler o arquivo'));
    }
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const credentials: Record<string, string | null> = {};
      for (const field of card.fields) {
        if (cleared[field.key]) { credentials[field.key] = null; continue; }
        const typed = values[field.key];
        if (typed) credentials[field.key] = typed; // vazio → omite → mantém
      }
      const enabledServices = card.services.filter(s => services[s.key]).map(s => s.key);
      await onSubmit(credentials, enabledServices);
    } catch (err) {
      setError(actionErrorMessage(err, 'Falha ao salvar as credenciais'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${card.label} — ${card.environment === 'sandbox' ? 'Sandbox' : 'Produção'}`}
      subTitle={`${card.key} · ${card.environment}`}
    >
      <Drawer.Body>
        {error && <div role="alert" className="alert alert-error">{error}</div>}

        {card.services.length > 0 && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 20px' }}>
            <legend style={{ padding: 0 }}>Serviços habilitados</legend>
            {card.services.map(s => (
              <div className="int-service-row" key={s.key}>
                <div>
                  <div className="int-service-row__label">{s.label}</div>
                  {s.help && <p className="int-service-row__help">{s.help}</p>}
                </div>
                <Switch
                  checked={!!services[s.key]}
                  disabled={saving}
                  onChange={() => toggleService(s.key)}
                  label={s.label}
                />
              </div>
            ))}
          </fieldset>
        )}

        {card.fields.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Esta integração não pede credenciais.
          </p>
        ) : card.fields.map(field => {
          const isCleared = !!cleared[field.key];
          return (
            <div className="field" key={field.key}>
              <div className="int-field-head">
                <label htmlFor={`cred-${field.key}`}>
                  {field.label}
                  {field.required && <span className="int-field-required" title="Campo obrigatório">*</span>}
                </label>
                {field.filled && (
                  <button type="button" className="int-field-clear" onClick={() => toggleCleared(field.key)}>
                    {isCleared ? 'Desfazer' : 'Limpar'}
                  </button>
                )}
              </div>

              {field.type === 'file' ? (
                <input
                  id={`cred-${field.key}`}
                  type="file"
                  disabled={isCleared || saving}
                  onChange={e => void handleFile(field, e.target.files?.[0])}
                />
              ) : (
                <input
                  id={`cred-${field.key}`}
                  type={field.type === 'password' ? 'password' : 'text'}
                  autoComplete="off"
                  disabled={isCleared || saving}
                  value={values[field.key] ?? ''}
                  placeholder={field.filled ? keepPlaceholder(field) : ''}
                  onChange={e => setValue(field.key, e.target.value)}
                />
              )}

              {isCleared && <p className="int-field-cleared">Será apagado ao salvar.</p>}
              {!isCleared && field.type === 'file' && fileNames[field.key] && (
                <p className="int-field-filled">Selecionado: {fileNames[field.key]}</p>
              )}
              {!isCleared && field.type === 'file' && field.filled && !fileNames[field.key] && (
                <p className="int-field-filled">{KEEP_HINT}</p>
              )}
              {field.help && <p className="int-field-hint">{field.help}</p>}
            </div>
          );
        })}
      </Drawer.Body>

      <Drawer.Footer>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </Drawer.Footer>
    </Drawer>
  );
}

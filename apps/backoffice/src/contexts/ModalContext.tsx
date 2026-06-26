import { createContext, useContext, useRef, useState, useCallback, ReactNode } from 'react';
import { ApiError } from '../lib/api';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ErrorOptions {
  title: string;
  message: string;
  technical?: string;
  onRetry?: () => void;
}

export interface SuccessOptions {
  title: string;
  message: string;
}

export type ModalState =
  | { kind: 'confirm'; opts: ConfirmOptions }
  | { kind: 'error';   opts: ErrorOptions }
  | { kind: 'success'; opts: SuccessOptions }
  | null;

interface Ctx {
  state:    ModalState;
  _resolve: (v: boolean) => void;
  _close:   () => void;
  confirm:  (opts: ConfirmOptions) => Promise<boolean>;
  error:    (err: unknown, onRetry?: () => void) => void;
  success:  (message: string, title?: string) => void;
}

const ModalCtx = createContext<Ctx | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [state, setState]   = useState<ModalState>(null);
  const resolveRef          = useRef<((v: boolean) => void) | null>(null);

  const _resolve = useCallback((v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setState(null);
  }, []);

  const _close = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> =>
    new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ kind: 'confirm', opts });
    }), []);

  const error = useCallback((err: unknown, onRetry?: () => void) => {
    setState({ kind: 'error', opts: humanize(err, onRetry) });
  }, []);

  const success = useCallback((message: string, title = 'Sucesso') => {
    setState({ kind: 'success', opts: { title, message } });
  }, []);

  return (
    <ModalCtx.Provider value={{ state, _resolve, _close, confirm, error, success }}>
      {children}
    </ModalCtx.Provider>
  );
}

export function useModal(): Ctx {
  const ctx = useContext(ModalCtx);
  if (!ctx) throw new Error('useModal requires ModalProvider');
  return ctx;
}

function humanize(err: unknown, onRetry?: () => void): ErrorOptions {
  if (!(err instanceof ApiError)) {
    return {
      title:     'Ops, algo deu errado',
      message:   err instanceof Error ? err.message : 'Erro inesperado.',
      technical: String(err),
      onRetry,
    };
  }
  const { status, message } = err;
  if (status === 0)  return { title: 'Sem conexão', message: 'Não conseguimos falar com o servidor. Verifique sua internet e tente novamente.', onRetry };
  if (status === 401) return { title: 'Sessão expirada', message: 'Sua sessão expirou. Faça login novamente para continuar.' };
  if (status === 403) return { title: 'Sem permissão', message: 'Você não tem autorização para realizar esta ação.' };
  if (status >= 500)  return { title: 'Algo não saiu como planejado', message: 'Todo mundo erra — desta vez foram nossos engenheiros. Já foram notificados e estão trabalhando nisso!', technical: `HTTP ${status}: ${message}`, onRetry };
  return {
    title:   status === 409 ? 'Conflito de dados' : status === 404 ? 'Não encontrado' : 'Atenção',
    message,
  };
}

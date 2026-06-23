import { createContext, useContext, useState, ReactNode } from 'react';
import ptBR, { TKey } from './pt-BR';
import en from './en';

type Lang = 'pt-BR' | 'en';
const TRANSLATIONS: Record<Lang, Record<string, string>> = { 'pt-BR': ptBR, en };
const LS_KEY = 'orquestra-lang';

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(LS_KEY) as Lang) ?? 'pt-BR',
  );

  function setLang(l: Lang) {
    localStorage.setItem(LS_KEY, l);
    setLangState(l);
  }

  function t(key: TKey): string {
    return TRANSLATIONS[lang][key] ?? TRANSLATIONS['pt-BR'][key] ?? key;
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}

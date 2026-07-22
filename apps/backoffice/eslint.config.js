// ESLint do backoffice — introduzido depois de um bug que serviu TELA BRANCA em
// produção: `useEffect` chamado depois de um `return null` condicional dispara o
// React error #300 ("Rendered fewer hooks than expected") e derruba a árvore
// inteira. TypeScript não pega isso; `react-hooks/rules-of-hooks` pega.
//
// FILOSOFIA DESTA CONFIG: o projeto passou a existir sem lint nenhum, então
// ligar um preset inteiro de uma vez produziria centenas de erros e o time
// aprenderia a ignorar a saída — pior que não ter lint.
//
// Por isso:
//   · ERROR  → só o que indica BUG REAL (hooks condicionais, promise ignorada
//              em handler, comparação sempre falsa...). Precisa ficar em zero.
//   · WARN   → o que é dívida legítima mas não quebra nada hoje. Aparece, não
//              bloqueia, e pode ser reduzido aos poucos.
// Subir uma regra de warn para error é barato quando a dívida dela zerar.
//
// Regras do React Compiler (o plugin v7 traz dezenas) ficam DE FORA: o projeto
// não usa o compiler, e elas exigiriam uma refatoração ampla sem ganho hoje.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ── O motivo desta config existir ────────────────────────────────────
      // Hook condicional / depois de return antecipado. NUNCA rebaixar para
      // warn: é exatamente a classe de bug que serviu tela branca em /company.
      'react-hooks/rules-of-hooks': 'error',

      // Dependência faltando em useEffect/useMemo/useCallback. Fica em warn
      // porque o código atual tem muitos casos e "corrigir" na marra (só
      // adicionar a dep) pode criar loop de render — cada caso pede análise.
      'react-hooks/exhaustive-deps': 'warn',

      // ── Ajustes ao preset TS ─────────────────────────────────────────────
      // `any` é dívida real, mas está espalhado (ex.: `(request as any).user`
      // no padrão de rotas). Warn para ficar visível sem travar o build.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Variável não usada é quase sempre resíduo de refactor — mas `_` como
      // prefixo é convenção deliberada no repo para "ignorado de propósito".
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Redundante com o compilador do TS, e dá falso positivo em sobrecarga.
      'no-undef': 'off',
      // Interferem com padrões idiomáticos de TS já usados aqui.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // Testes: console e any são ferramenta legítima de diagnóstico.
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);

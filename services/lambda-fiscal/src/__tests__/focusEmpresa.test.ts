import { describe, it, expect } from 'vitest';
import { FocusEmpresaClient } from '../lib/focusEmpresa';

describe('FocusEmpresaClient simulation mode', () => {
  it('returns created empresa with tokens for local-* tokens', async () => {
    const client = new FocusEmpresaClient('local-test', 2);
    const res = await client.criar({ cnpj: '12345678000190', nome: 'Empresa LTDA' });
    expect(res.id).toContain('demo-');
    expect(res.token_producao).toContain('local-prod-');
    expect(res.token_homologacao).toContain('local-homolog-');
    expect(res.erros).toBeUndefined();
  });

  it('returns erros for local-reject tokens', async () => {
    const client = new FocusEmpresaClient('local-reject', 2);
    const res = await client.criar({ cnpj: '12345678000190' });
    expect(res.erros?.length).toBeGreaterThan(0);
    expect(res.token_producao).toBeUndefined();
  });
});

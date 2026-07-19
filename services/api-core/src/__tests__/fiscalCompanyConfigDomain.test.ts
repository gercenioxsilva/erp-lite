// Domínio puro do cadastro fiscal (0069): normalização CNAE/LC116/competência,
// gate de readiness e parsing de certificado A1 — o .pfx do teste é gerado em
// memória com node-forge (self-signed), sem fixture binária no repo.

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import {
  normalizeCnae, normalizeLc116, validateCompetencia,
  parseA1Certificate, evaluateEmissionReadiness, FiscalDomainError,
} from '../domain/fiscal/fiscalCompanyConfigDomain';

function makePfx(password: string, cn = 'EMPRESA TESTE:11222333000181', days = 365): string {
  const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 só p/ teste rápido
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + days * 86_400_000);
  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

describe('normalizeCnae / normalizeLc116 / validateCompetencia', () => {
  it('aceita CNAE formatado e cru', () => {
    expect(normalizeCnae('9602-5/01')).toBe('9602501');
    expect(normalizeCnae('9602501')).toBe('9602501');
  });
  it('rejeita CNAE inválido com code tipado', () => {
    expect(() => normalizeCnae('123')).toThrowError(FiscalDomainError);
    try { normalizeCnae('123'); } catch (e: any) { expect(e.code).toBe('invalid_cnae'); }
  });
  it('normaliza item LC116 para NN.NN', () => {
    expect(normalizeLc116('14.01')).toBe('14.01');
    expect(normalizeLc116('7.2')).toBe('7.02');
    expect(() => normalizeLc116('abc')).toThrowError(FiscalDomainError);
  });
  it('valida competência YYYY-MM', () => {
    expect(validateCompetencia('2026-07')).toBe('2026-07');
    expect(() => validateCompetencia('2026-13')).toThrowError(FiscalDomainError);
    expect(() => validateCompetencia('07/2026')).toThrowError(FiscalDomainError);
  });
});

describe('parseA1Certificate', () => {
  it('extrai CN, validade e thumbprint de um .pfx válido', () => {
    const pfx = makePfx('senha123');
    const parsed = parseA1Certificate(pfx, 'senha123');
    expect(parsed.cn).toContain('EMPRESA TESTE');
    expect(parsed.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(parsed.thumbprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it('senha errada vira invalid_certificate_or_password (nunca 500 cru)', () => {
    const pfx = makePfx('senha123');
    try { parseA1Certificate(pfx, 'errada'); expect.unreachable(); }
    catch (e: any) { expect(e).toBeInstanceOf(FiscalDomainError); expect(e.code).toBe('invalid_certificate_or_password'); }
  });

  it('base64 corrompido também é erro tipado', () => {
    try { parseA1Certificate('not-a-pfx', 'x'); expect.unreachable(); }
    catch (e: any) { expect(e.code).toBe('invalid_certificate_or_password'); }
  });
});

describe('evaluateEmissionReadiness (gate VALIDAR)', () => {
  const base = {
    docType: 'nfse' as const, optanteSimples: true, enquadramento: 'ME',
    nfseProvider: 'abrasf', hasServiceCode: true, inscricaoMunicipal: '12345',
    certificate: { notAfter: new Date(Date.now() + 86_400_000) }, now: new Date(),
  };

  it('pronto quando tudo presente', () => {
    expect(evaluateEmissionReadiness(base)).toEqual({ ready: true, reasons: [] });
  });

  it('lista TODAS as pendências de uma vez', () => {
    const out = evaluateEmissionReadiness({ ...base, inscricaoMunicipal: null, hasServiceCode: false, certificate: null });
    expect(out.ready).toBe(false);
    expect(out.reasons).toEqual(expect.arrayContaining(['inscricao_municipal_missing', 'service_code_missing', 'certificate_missing']));
  });

  it('certificado expirado bloqueia provider próprio', () => {
    const out = evaluateEmissionReadiness({ ...base, certificate: { notAfter: new Date(Date.now() - 1000) } });
    expect(out.reasons).toContain('certificate_expired');
  });

  it("provider 'focus' não exige certificado próprio", () => {
    const out = evaluateEmissionReadiness({ ...base, nfseProvider: 'focus', certificate: null });
    expect(out).toEqual({ ready: true, reasons: [] });
  });
});

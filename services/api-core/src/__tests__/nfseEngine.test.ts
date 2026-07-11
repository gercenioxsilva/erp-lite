// Motor NFS-e (0074): builder ABRASF v2 puro + assinatura XMLDSig real
// (certificado gerado em memória). Valida os pontos que derrubam homologação:
// enveloped+C14N declarados na Reference, Id↔URI, X509Certificate no KeyInfo,
// SignatureValue/DigestValue presentes, e assinatura DENTRO do pai correto.

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { buildRpsXml, buildLoteXml, buildCancelXml, rpsInfId, AbrasfXmlError } from '../domain/nfse/abrasfXml';
import { loadCertificateFromPfx, signXmlElement, XmlSignError } from '../domain/nfse/xmlSigner';

function makePfx(password: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'EMPRESA NFSE:11222333000181' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const RPS_INPUT = {
  rpsNumero: 42, rpsSerie: '1', dataEmissao: new Date('2026-07-02T10:00:00Z'),
  valorServicos: 1500, aliquotaIss: 5, issRetido: false,
  itemListaServico: '14.01', codigoMunicipioIbge: '2510808',
  discriminacao: 'Serviços consolidados 2026-07 & manutenção <mensal>',
  prestador: { cnpj: '11222333000181', inscricaoMunicipal: '12345' },
  tomador: { document: '39053344705', razaoSocial: 'Cliente & Filhos' },
  optanteSimples: true,
};

describe('abrasfXml (builder puro)', () => {
  it('gera RPS v2 com Id assinável, escaping e ISS informativo p/ Simples', () => {
    const xml = buildRpsXml(RPS_INPUT);
    expect(xml).toContain(`InfDeclaracaoPrestacaoServico Id="${rpsInfId(RPS_INPUT)}"`);
    expect(xml).toContain('<OptanteSimplesNacional>1</OptanteSimplesNacional>');
    expect(xml).toContain('<IssRetido>2</IssRetido>'); // não retido
    expect(xml).toContain('<ItemListaServico>14.01</ItemListaServico>');
    expect(xml).toContain('&amp; manutenção &lt;mensal&gt;'); // escaping
    expect(xml).toContain('<Cpf>39053344705</Cpf>');
    expect(xml).toContain('<ValorServicos>1500.00</ValorServicos>');
  });

  it('valida CNPJ do prestador e item LC116', () => {
    expect(() => buildRpsXml({ ...RPS_INPUT, prestador: { cnpj: '123', inscricaoMunicipal: 'x' } }))
      .toThrowError(AbrasfXmlError);
    expect(() => buildRpsXml({ ...RPS_INPUT, itemListaServico: '' })).toThrowError(AbrasfXmlError);
  });

  it('lote embrulha RPS assinados com namespace abrasf', () => {
    const lote = buildLoteXml({ loteId: 7, prestador: RPS_INPUT.prestador, signedRpsXml: ['<Rps>a</Rps>', '<Rps>b</Rps>'] });
    expect(lote).toContain('xmlns="http://www.abrasf.org.br/nfse.xsd"');
    expect(lote).toContain('<QuantidadeRps>2</QuantidadeRps>');
    expect(lote).toContain('LoteRps Id="lote7"');
  });

  it('cancelamento assina InfPedidoCancelamento', () => {
    const xml = buildCancelXml({ nfseNumero: '123', prestador: RPS_INPUT.prestador, codigoMunicipioIbge: '2510808' });
    expect(xml).toContain('InfPedidoCancelamento Id="cancel123"');
    expect(xml).toContain('<CodigoCancelamento>2</CodigoCancelamento>');
  });
});

describe('xmlSigner (assinatura real)', () => {
  const pfx = makePfx('senha123');
  const cert = loadCertificateFromPfx(pfx, 'senha123');

  it('assina o InfDeclaracaoPrestacaoServico com enveloped+C14N, Id↔URI e X509', () => {
    const rps = buildRpsXml(RPS_INPUT);
    const id = rpsInfId(RPS_INPUT);
    const signed = signXmlElement(rps, {
      referenceId: id, elementName: 'InfDeclaracaoPrestacaoServico',
      algo: 'rsa-sha1', c14n: 'inclusive', cert,
    });
    expect(signed).toContain(`<Reference URI="#${id}">`);
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(signed).toContain('Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
    expect(signed).toMatch(/<DigestValue>[A-Za-z0-9+/=]+<\/DigestValue>/);
    expect(signed).toMatch(/<SignatureValue>[A-Za-z0-9+/=\s]+<\/SignatureValue>/);
    expect(signed).toContain('<X509Certificate>');
    // Assinatura entra DEPOIS do elemento referenciado, dentro do <Rps> (irmã).
    expect(signed.indexOf('<Signature')).toBeGreaterThan(signed.indexOf('</InfDeclaracaoPrestacaoServico>'));
  });

  it('rsa-sha256 + C14N exclusiva (perfil Nacional/v2 moderno)', () => {
    const rps = buildRpsXml(RPS_INPUT);
    const signed = signXmlElement(rps, {
      referenceId: rpsInfId(RPS_INPUT), elementName: 'InfDeclaracaoPrestacaoServico',
      algo: 'rsa-sha256', c14n: 'exclusive', cert,
    });
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"');
  });

  it('senha errada e pfx corrompido são erros tipados', () => {
    expect(() => loadCertificateFromPfx(pfx, 'errada')).toThrowError(XmlSignError);
    expect(() => loadCertificateFromPfx('garbage', 'x')).toThrowError(XmlSignError);
  });
});

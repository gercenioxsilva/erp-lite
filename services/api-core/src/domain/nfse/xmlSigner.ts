// Assinador XMLDSig para NFS-e (ABRASF/Nacional) — node-forge abre o .pfx,
// xml-crypto assina. Pontos que derrubam homologação se errados (por isso
// centralizados e configuráveis por município via nfse_municipalities):
//   1. Reference DECLARA os dois Transforms: enveloped-signature E o C14N;
//   2. Id do elemento assinado casa com Reference URI="#...";
//   3. KeyInfo embute o X509Certificate (base64, sem headers PEM);
//   4. algoritmo (rsa-sha1 legado vs rsa-sha256) e C14N (inclusiva vs
//      exclusiva) variam por município.

import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

export class XmlSignError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'XmlSignError';
  }
}

const ALGO = {
  'rsa-sha1': {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest:    'http://www.w3.org/2000/09/xmldsig#sha1',
  },
  'rsa-sha256': {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest:    'http://www.w3.org/2001/04/xmlenc#sha256',
  },
} as const;

const C14N = {
  inclusive: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  exclusive: 'http://www.w3.org/2001/10/xml-exc-c14n#',
} as const;

const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export interface LoadedCertificate {
  privateKeyPem: string;
  certificatePem: string;
  certificateBase64: string; // DER base64, sem headers (vai no X509Certificate)
}

/** Abre o .pfx/.p12 e extrai chave + certificado em PEM (e DER base64). */
export function loadCertificateFromPfx(pfxBase64: string, senha: string): LoadedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(pfxBase64)), senha);
  } catch {
    throw new XmlSignError('invalid_certificate_or_password');
  }
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const key = keyBags.map((b) => b.key).find(Boolean);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const cert = certBags.map((b) => b.cert).find(Boolean);
  if (!key || !cert) throw new XmlSignError('pfx_missing_key_or_cert');

  const certificatePem = forge.pki.certificateToPem(cert);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey),
    certificatePem,
    certificateBase64: forge.util.encode64(der),
  };
}

export interface SignOptions {
  /** Valor do atributo Id do elemento assinado (Reference URI = '#'+id). */
  referenceId: string;
  /** local-name() do elemento assinado (InfRps | InfDeclaracaoPrestacaoServico | InfPedidoCancelamento | infDPS). */
  elementName: string;
  algo: keyof typeof ALGO;
  c14n: keyof typeof C14N;
  cert: LoadedCertificate;
}

/**
 * Assinatura enveloped: o <Signature> entra como último filho do PAI do
 * elemento referenciado (padrão ABRASF: assinatura irmã do Inf*, dentro do
 * Rps/Pedido). Retorna o XML assinado como string.
 */
export function signXmlElement(xml: string, opts: SignOptions): string {
  const algo = ALGO[opts.algo];
  const c14n = C14N[opts.c14n];

  const signer = new SignedXml({
    privateKey: opts.cert.privateKeyPem,
    publicCert: opts.cert.certificatePem,
    signatureAlgorithm: algo.signature,
    canonicalizationAlgorithm: c14n,
    // KeyInfo com o X509Certificate cru — exigência das prefeituras.
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${opts.cert.certificateBase64}</X509Certificate></X509Data>`,
  });

  signer.addReference({
    xpath: `//*[local-name(.)='${opts.elementName}' and @Id='${opts.referenceId}']`,
    uri: `#${opts.referenceId}`,
    transforms: [ENVELOPED, c14n],
    digestAlgorithm: algo.digest,
  });

  try {
    signer.computeSignature(xml, {
      location: { reference: `//*[local-name(.)='${opts.elementName}' and @Id='${opts.referenceId}']`, action: 'after' },
    });
  } catch (err) {
    throw new XmlSignError('signature_failed', { message: err instanceof Error ? err.message : String(err) });
  }
  return signer.getSignedXml();
}

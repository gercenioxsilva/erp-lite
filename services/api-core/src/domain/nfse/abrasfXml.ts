// Builder PURO do XML ABRASF v2.x (namespace http://www.abrasf.org.br/nfse.xsd):
// EnviarLoteRpsSincronoEnvio (emissão) e CancelarNfseEnvio (cancelamento).
// Portado conceitualmente do nfephp-org/sped-nfse; a ordem dos elementos segue
// o XSD (schema valida ANTES da assinatura — ordem errada rejeita silencioso).
// Perfis municipais (webiss/issnet) mudam endpoint/assinatura via registry,
// não a estrutura — desvios pontuais entram por parâmetro quando homologados.

export class AbrasfXmlError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AbrasfXmlError';
  }
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n: number): string => n.toFixed(2);

export interface AbrasfPrestador {
  cnpj: string;              // dígitos
  inscricaoMunicipal: string;
}

export interface AbrasfTomador {
  document?: string | null;  // CPF (11) ou CNPJ (14), dígitos
  razaoSocial?: string | null;
}

export interface AbrasfRpsInput {
  rpsNumero: number;
  rpsSerie: string;
  dataEmissao: Date;
  valorServicos: number;
  deducoes?: number;
  aliquotaIss: number;       // % (ex.: 5.00)
  issRetido: boolean;
  itemListaServico: string;  // LC116 'NN.NN'
  codigoMunicipioIbge: string;
  discriminacao: string;
  prestador: AbrasfPrestador;
  tomador?: AbrasfTomador | null;
  optanteSimples: boolean;
}

/** Id do elemento assinável do RPS (Reference URI). */
export function rpsInfId(input: Pick<AbrasfRpsInput, 'rpsNumero' | 'rpsSerie'>): string {
  return `rps${input.rpsSerie}${input.rpsNumero}`;
}

/**
 * Rps ABRASF v2: o elemento ASSINADO é InfDeclaracaoPrestacaoServico (Id).
 * ISS de optante do Simples: informativo (dentro do DAS) — ExigibilidadeISS=1
 * e OptanteSimplesNacional=1; só IssRetido=1 gera retenção real pelo tomador.
 */
export function buildRpsXml(input: AbrasfRpsInput): string {
  if (!/^\d{14}$/.test(input.prestador.cnpj)) throw new AbrasfXmlError('invalid_prestador_cnpj');
  if (!input.itemListaServico) throw new AbrasfXmlError('missing_item_lista_servico');

  const id = rpsInfId(input);
  const data = input.dataEmissao.toISOString().slice(0, 19);
  const competencia = input.dataEmissao.toISOString().slice(0, 10);
  const deducoes = input.deducoes ?? 0;

  const tomadorXml = input.tomador?.document
    ? `<Tomador><IdentificacaoTomador><CpfCnpj>${
        input.tomador.document.length === 11
          ? `<Cpf>${input.tomador.document}</Cpf>`
          : `<Cnpj>${input.tomador.document}</Cnpj>`
      }</CpfCnpj></IdentificacaoTomador>${
        input.tomador.razaoSocial ? `<RazaoSocial>${esc(input.tomador.razaoSocial)}</RazaoSocial>` : ''
      }</Tomador>`
    : '';

  return (
    `<Rps>` +
      `<InfDeclaracaoPrestacaoServico Id="${id}">` +
        `<Rps>` +
          `<IdentificacaoRps>` +
            `<Numero>${input.rpsNumero}</Numero>` +
            `<Serie>${esc(input.rpsSerie)}</Serie>` +
            `<Tipo>1</Tipo>` +
          `</IdentificacaoRps>` +
          `<DataEmissao>${data}</DataEmissao>` +
          `<Status>1</Status>` +
        `</Rps>` +
        `<Competencia>${competencia}</Competencia>` +
        `<Servico>` +
          `<Valores>` +
            `<ValorServicos>${money(input.valorServicos)}</ValorServicos>` +
            (deducoes > 0 ? `<ValorDeducoes>${money(deducoes)}</ValorDeducoes>` : '') +
            `<Aliquota>${input.aliquotaIss.toFixed(2)}</Aliquota>` +
          `</Valores>` +
          `<IssRetido>${input.issRetido ? 1 : 2}</IssRetido>` +
          `<ItemListaServico>${esc(input.itemListaServico)}</ItemListaServico>` +
          `<Discriminacao>${esc(input.discriminacao)}</Discriminacao>` +
          `<CodigoMunicipio>${input.codigoMunicipioIbge}</CodigoMunicipio>` +
          `<ExigibilidadeISS>1</ExigibilidadeISS>` +
        `</Servico>` +
        `<Prestador>` +
          `<CpfCnpj><Cnpj>${input.prestador.cnpj}</Cnpj></CpfCnpj>` +
          `<InscricaoMunicipal>${esc(input.prestador.inscricaoMunicipal)}</InscricaoMunicipal>` +
        `</Prestador>` +
        tomadorXml +
        `<OptanteSimplesNacional>${input.optanteSimples ? 1 : 2}</OptanteSimplesNacional>` +
        `<IncentivoFiscal>2</IncentivoFiscal>` +
      `</InfDeclaracaoPrestacaoServico>` +
    `</Rps>`
  );
}

/** Envelope do lote síncrono. Recebe os RPS já ASSINADOS. */
export function buildLoteXml(args: {
  loteId: number; prestador: AbrasfPrestador; signedRpsXml: string[];
}): string {
  return (
    `<EnviarLoteRpsSincronoEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">` +
      `<LoteRps Id="lote${args.loteId}" versao="2.02">` +
        `<NumeroLote>${args.loteId}</NumeroLote>` +
        `<CpfCnpj><Cnpj>${args.prestador.cnpj}</Cnpj></CpfCnpj>` +
        `<InscricaoMunicipal>${esc(args.prestador.inscricaoMunicipal)}</InscricaoMunicipal>` +
        `<QuantidadeRps>${args.signedRpsXml.length}</QuantidadeRps>` +
        `<ListaRps>${args.signedRpsXml.join('')}</ListaRps>` +
      `</LoteRps>` +
    `</EnviarLoteRpsSincronoEnvio>`
  );
}

/** Pedido de cancelamento — o elemento assinado é InfPedidoCancelamento. */
export function buildCancelXml(args: {
  nfseNumero: string; prestador: AbrasfPrestador; codigoMunicipioIbge: string;
  codigoCancelamento?: string; // 1=erro emissão, 2=serviço não prestado…
}): string {
  const id = `cancel${args.nfseNumero}`;
  return (
    `<CancelarNfseEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">` +
      `<Pedido>` +
        `<InfPedidoCancelamento Id="${id}">` +
          `<IdentificacaoNfse>` +
            `<Numero>${args.nfseNumero}</Numero>` +
            `<CpfCnpj><Cnpj>${args.prestador.cnpj}</Cnpj></CpfCnpj>` +
            `<InscricaoMunicipal>${esc(args.prestador.inscricaoMunicipal)}</InscricaoMunicipal>` +
            `<CodigoMunicipio>${args.codigoMunicipioIbge}</CodigoMunicipio>` +
          `</IdentificacaoNfse>` +
          `<CodigoCancelamento>${args.codigoCancelamento ?? '2'}</CodigoCancelamento>` +
        `</InfPedidoCancelamento>` +
      `</Pedido>` +
    `</CancelarNfseEnvio>`
  );
}

export const CANCEL_INF_ID = (nfseNumero: string): string => `cancel${nfseNumero}`;

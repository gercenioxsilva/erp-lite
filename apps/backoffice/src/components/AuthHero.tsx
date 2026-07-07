import { GaxLogo } from './GaxLogo';
import { useI18n } from '../i18n';

interface Category { icon: string; title: string; items: string[]; }

const CATEGORIES_PT: Category[] = [
  { icon: '🧾', title: 'Fiscal',       items: ['NF-e, NFC-e e NFS-e', 'Boleto + Pix integrados'] },
  { icon: '💰', title: 'Financeiro',   items: ['DRE Gerencial automática', 'Centro de Custo e Comissão'] },
  { icon: '📦', title: 'Operacional',  items: ['PDV completo', 'Ordens de Serviço + Técnicos'] },
  { icon: '🏢', title: 'Multi-empresa', items: ['Múltiplos CNPJs numa conta', 'Integração com Mercado Livre'] },
];

const CATEGORIES_EN: Category[] = [
  { icon: '🧾', title: 'Tax & Fiscal', items: ['NF-e, NFC-e & NFS-e', 'Boleto + Pix built-in'] },
  { icon: '💰', title: 'Financial',    items: ['Automatic P&L (DRE)', 'Cost centers & commissions'] },
  { icon: '📦', title: 'Operations',   items: ['Full POS', 'Field service + technicians'] },
  { icon: '🏢', title: 'Multi-company', items: ['Multiple CNPJs, one account', 'Mercado Livre integration'] },
];

const HIGHLIGHT_PT = '3 em 1 no fiscal: NF-e + NFC-e + NFS-e — a maioria dos concorrentes cobre só um tipo de nota.';
const HIGHLIGHT_EN = '3-in-1 tax compliance: NF-e + NFC-e + NFS-e — most competitors cover only one document type.';

/**
 * Branded left-hand hero for the auth surface (login, forgot, reset).
 * Hidden below 960px via the `.ls-hero` rule. Purely presentational —
 * keeping it shared makes the whole auth flow one continuous surface.
 */
export function AuthHero() {
  const { lang } = useI18n();
  const categories = lang === 'pt-BR' ? CATEGORIES_PT : CATEGORIES_EN;
  const highlight  = lang === 'pt-BR' ? HIGHLIGHT_PT  : HIGHLIGHT_EN;

  return (
    <section className="ls-hero" aria-hidden="true">
      <div className="ls-orb ls-orb-1" />
      <div className="ls-orb ls-orb-2" />
      <div className="ls-orb ls-orb-3" />
      <div className="ls-dots" />
      <div className="ls-top-line" />

      <div className="ls-hero-body">
        <div className="ls-hero-logo">
          <GaxLogo size="xxl" variant="full" theme="dark" />
        </div>

        <h1 className="ls-headline">
          {lang === 'pt-BR'
            ? <>O ERP completo que cresce<br />com o seu <span className="ls-grad-text">negócio</span></>
            : <>The complete ERP that grows<br />with your <span className="ls-grad-text">business</span></>}
        </h1>

        <p className="ls-subline">
          {lang === 'pt-BR'
            ? 'Do fiscal ao campo: nota fiscal, financeiro, estoque, PDV e equipe técnica — tudo integrado, sem depender de várias ferramentas soltas.'
            : 'From tax compliance to field service: invoicing, finance, inventory, POS and field teams — all integrated, no juggling separate tools.'}
        </p>

        <div className="ls-category-grid">
          {categories.map(c => (
            <div key={c.title} className="ls-category-card">
              <span className="ls-category-icon" aria-hidden="true">{c.icon}</span>
              <strong className="ls-category-title">{c.title}</strong>
              <ul>
                {c.items.map(i => <li key={i}>{i}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="ls-highlight-strip">
          <span className="ls-highlight-icon" aria-hidden="true">⚡</span>
          {highlight}
        </div>

        <div className="ls-social-proof">
          <div className="ls-avatars">
            {['#6366f1','#06b6d4','#8b5cf6','#ec4899'].map((c, i) => (
              <span key={i} className="ls-avatar" style={{ background: c, zIndex: 4 - i }} />
            ))}
          </div>
          <span>
            {lang === 'pt-BR'
              ? <>Confiado por <strong>500+</strong> empresas no Brasil</>
              : <>Trusted by <strong>500+</strong> companies across Brazil</>}
          </span>
        </div>
      </div>
    </section>
  );
}

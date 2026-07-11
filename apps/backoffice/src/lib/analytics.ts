// Empurra eventos pro dataLayer do Google Tag Manager (container GTM-MKQ4DVHF
// em index.html). Nunca inclui PII (nome, e-mail, CNPJ) — só marcos de funil
// e dimensões de negócio não identificáveis (ex.: segment_key), pra não violar
// a política de dados pessoais do GA4.
declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function trackEvent(event: string, params: Record<string, string | number | boolean> = {}): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

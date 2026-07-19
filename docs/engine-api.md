# Fiscal Engine API — cálculo do Simples Nacional para o seu sistema

API REST de cálculo tributário do Simples Nacional. Você manda os números, recebe o cálculo com a memória completa — **nenhum dado seu é armazenado** (só o contador de chamadas por chave). As tabelas legais (Anexos I–V, LC 123/155) são versionadas por vigência e atualizadas centralmente: mudou a lei, seu cálculo atualiza sem você fazer deploy.

> O motor é o mesmo usado pela apuração PGDAS-D do ERP, validado ao centavo contra DAS reais emitidos pela Receita.

## Autenticação

Toda chamada leva o header `X-API-Key`. Crie a chave em **Minha Empresa → Integrações → API do Motor Fiscal** (o segredo aparece **uma única vez**).

```
X-API-Key: ek_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Limite padrão: **60 req/min por chave** (headers `X-RateLimit-Limit` / `X-RateLimit-Remaining`; estouro → `429` com `Retry-After`). Erros seguem o envelope `{"success": false, "error": "<codigo>"}` — `401` chave ausente/inválida/revogada, `403` sem escopo, `400` entrada malformada, `422` recusa do domínio tributário.

## Endpoints

### 1. `POST /v1/engine/simples/apurar` — DAS por tributo

```bash
curl -X POST https://<host>/v1/engine/simples/apurar \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "competencia": "2026-02",
    "rbt12": 33600,
    "anexos": [{ "anexo": "III", "receita": 2800, "receita_com_retencao": 0 }]
  }'
```

```json
{
  "success": true,
  "data": {
    "dasTotal": 168,
    "tributos": { "irpj": 6.72, "csll": 5.88, "cofins": 21.54, "pis": 4.67, "cpp": 72.91, "icms": 0, "ipi": 0, "iss": 56.28 },
    "issRetidoTotal": 0,
    "sublimiteExcedido": false,
    "memoria": { "porAnexo": [{ "faixa": 1, "aliquotaEfetiva": 6, "...": "memória completa" }] }
  }
}
```

Regras aplicadas: alíquota efetiva (LC 123 art. 18), teto de 5% do ISS com redistribuição (§22-A), sublimite de R$ 3,6M (ICMS/ISS por fora), Anexo IV sem CPP, ISS retido abatido, empresa mista (vários anexos somam).

### 2. `POST /v1/engine/simples/rbt12` — receita bruta dos últimos 12 meses

Janela dos 12 meses **anteriores** à competência (a própria competência não entra), com proporcionalização de início de atividade (< 12 meses → média × 12; 1º mês → receita × 12).

```bash
curl -X POST https://<host>/v1/engine/simples/rbt12 \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "competencia": "2026-02",
    "data_abertura": "2023-08-15",
    "receitas_por_competencia": { "2025-02": 2800, "2025-03": 2800, "...": 2800, "2026-01": 2800 }
  }'
```

→ `{"success": true, "data": {"competencia": "2026-02", "rbt12": 33600}}`

### 3. `POST /v1/engine/simples/fator-r` — Anexo III ou V

```bash
curl -X POST https://<host>/v1/engine/simples/fator-r \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ "folha_12m": 2800, "receita_12m": 10000, "meses_com_folha": 12 }'
```

→ `{"success": true, "data": {"fator_r": 0.28, "anexo": "III"}}`

Com menos de 12 meses de folha a chamada é **recusada** (`422 folha_12m_incompleta`) em vez de assumir zero — folha subestimada jogaria a empresa indevidamente no Anexo V.

### 4. `POST /v1/engine/simples/projecao` — DAS projetado + distância de faixa

```bash
curl -X POST https://<host>/v1/engine/simples/projecao \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ "competencia": "2026-02", "rbt12": 33600, "anexo": "III", "receita_mes": 2800, "receita_pipeline": 0 }'
```

→ `data.projecao` (DAS projetado, alíquota efetiva, faixa) + `data.distancia_proxima_faixa` (`faltaParaProximaFaixa`, `efetivaNaProximaFaixa`).

### 5. `GET /v1/engine/tabelas/:anexo?vigencia=2026` — tabelas oficiais

Transparência do cálculo: as faixas (RBT12 mín/máx, alíquota nominal, parcela a deduzir) e a repartição por tributo da vigência consultada.

### 6. `POST /v1/engine/pgdasd/payload` — payload TRANSDECLARACAO11 (SERPRO)

Gera o objeto `dados` pronto para a **SERPRO Integra Contador** (transmissão do PGDAS-D) — para quem tem contrato SERPRO próprio. **Não transmite nada**: `indicador_transmissao` default `false` (conferência).

```bash
curl -X POST https://<host>/v1/engine/pgdasd/payload \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "cnpj": "00000000000191", "competencia": "2026-02", "regime": "competencia",
    "receita_mes": 2800, "id_atividade": 11,
    "receitas_brutas_anteriores": [{ "competencia": "2025-02", "valor": 2800 }],
    "folhas_salario": [{ "competencia": "2025-02", "valor": 1500 }],
    "valores_para_comparacao": { "iss": 56.28, "cpp": 72.91 }
  }'
```

⚠️ `id_atividade` é o **enum 1..43 do PGDAS-D** — não é o código LC 116 nem o CNAE. Serviço no próprio município: `11` (sujeito ao Fator R) ou `14` (Anexo III fixo); com ISS retido: `12`/`15`.

## Gestão de chaves (rotas internas do ERP, JWT)

| Rota | Efeito |
|---|---|
| `POST /v1/engine-keys` `{name}` | cria; a resposta traz `secret` **uma única vez** |
| `GET /v1/engine-keys` | lista (nunca devolve segredo) |
| `DELETE /v1/engine-keys/:id` | revoga (imediato, irreversível) |
| `GET /v1/engine-keys/usage?days=30` | uso por dia/endpoint |

Permissão: `engine:manage` (owner/admin).

## Limites e garantias

- Stateless: o request não é persistido; logs não incluem o corpo.
- Rate limit por chave (default 60/min, ajustável por chave no banco).
- Disponibilidade e versionamento: prefixo `/v1/` — mudanças incompatíveis só em `/v2/`.
- Medição: cada chamada conta em `api_key_usage` (base de eventual cobrança futura — hoje não há cobrança).

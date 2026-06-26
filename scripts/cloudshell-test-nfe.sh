#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# GAX ERP — Teste de NF-e no AWS CloudShell
#
# COMO USAR:
#   1. Abra o CloudShell no painel AWS (ícone >_ no topo direito)
#   2. Cole este script inteiro e pressione Enter
#   3. Siga os menus interativos
#
# O script detecta automaticamente a conta e os recursos AWS.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuração ─────────────────────────────────────────────────────────────
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENV_NAME="prod"
LAMBDA_NAME="erp-lite-fiscal-nfe-${ENV_NAME}"
QUEUE_REQ="erp-lite-nfe-requests-${ENV_NAME}"
QUEUE_RES="erp-lite-nfe-results-${ENV_NAME}"
QUEUE_DLQ="erp-lite-nfe-dlq-${ENV_NAME}"
LOG_GROUP="/aws/lambda/${LAMBDA_NAME}"

# Cores
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; GRAY='\033[0;37m'; BOLD='\033[1m'; NC='\033[0m'

header()  { echo -e "\n${BOLD}${CYAN}── $* ──────────────────────────────────────────────${NC}"; }
ok()      { echo -e "  ${GREEN}✓${NC}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $*"; }
fail()    { echo -e "  ${RED}✗${NC}  $*"; }
step()    { echo -e "\n${YELLOW}▶${NC}  $*"; }

# ── Verificação inicial ───────────────────────────────────────────────────────
header "GAX ERP · Teste NF-e · CloudShell"

step "Verificando identidade AWS..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
CALLER_ARN=$(aws sts get-caller-identity --query Arn     --output text --region "$REGION")
ok "Account : $ACCOUNT_ID"
ok "Caller  : $CALLER_ARN"
ok "Região  : $REGION"

S3_BUCKET="erp-lite-nfe-${ENV_NAME}-${ACCOUNT_ID}"

step "Resolvendo URLs das filas SQS..."
URL_REQ=$(aws sqs get-queue-url --queue-name "$QUEUE_REQ" --region "$REGION" --query QueueUrl --output text)
URL_RES=$(aws sqs get-queue-url --queue-name "$QUEUE_RES" --region "$REGION" --query QueueUrl --output text)
URL_DLQ=$(aws sqs get-queue-url --queue-name "$QUEUE_DLQ" --region "$REGION" --query QueueUrl --output text)
ok "requests : $URL_REQ"
ok "results  : $URL_RES"
ok "dlq      : $URL_DLQ"

# ── Menu principal ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Escolha o que deseja fazer:${NC}"
echo "  1) Injetar NF-e de teste diretamente no SQS (mais rápido)"
echo "  2) Ver status atual das filas e do Lambda"
echo "  3) Ver logs ao vivo do Lambda (últimas 50 linhas)"
echo "  4) Ler mensagens da fila nfe-results"
echo "  5) Ler mensagens da DLQ (falhas)"
echo "  6) Invocar Lambda diretamente com payload de teste"
echo "  7) Limpar fila nfe-results (purge)"
echo ""
read -rp "Opção [1-7]: " OPC

# ─────────────────────────────────────────────────────────────────────────────
# Opção 1 — Injetar mensagem no SQS
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "1" ]]; then
  header "Injeção direta no SQS nfe-requests"

  TIMESTAMP=$(date +%s)
  INVOICE_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  TENANT_ID=$(cat /proc/sys/kernel/random/uuid  2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  FOCUS_REF="CLOUDSHELL-TEST-${TIMESTAMP}"
  DATA_EMISSAO=$(date -u +"%Y-%m-%dT%H:%M:%S-03:00")

  PAYLOAD=$(cat <<EOF
{
  "invoice_id": "${INVOICE_ID}",
  "tenant_id":  "${TENANT_ID}",
  "focus_ref":  "${FOCUS_REF}",
  "ambiente":   2,
  "emitente": {
    "cnpj":              "28439340000132",
    "razao_social":      "EMPRESA TESTE GAX ERP LTDA",
    "logradouro":        "Rua das Acacias",
    "numero":            "100",
    "complemento":       "Sala 1",
    "bairro":            "Centro",
    "municipio":         "SAO PAULO",
    "uf":                "SP",
    "cep":               "01310100",
    "telefone":          "11999990000",
    "email":             "fiscal@teste.com.br",
    "regime_tributario": 2
  },
  "destinatario": {
    "cnpj":         "07504505000132",
    "nome":         "EMPRESA DESTINO TESTE LTDA",
    "indicador_ie": 9,
    "logradouro":   "Av. Paulista",
    "numero":       "1000",
    "bairro":       "Bela Vista",
    "municipio":    "SAO PAULO",
    "uf":           "SP",
    "cep":          "01310100",
    "email":        "destino@teste.com"
  },
  "natureza_operacao": "Venda de mercadoria",
  "data_emissao":      "${DATA_EMISSAO}",
  "itens": [
    {
      "numero_item":              1,
      "codigo_produto":           "PROD-TESTE-001",
      "descricao":                "Produto de Teste Homologacao GAX ERP",
      "ncm":                      "73181500",
      "cfop":                     "5102",
      "unidade_comercial":        "UN",
      "quantidade_comercial":     1,
      "valor_unitario_comercial": 100.00,
      "valor_bruto":              100.00,
      "icms_cst":                 "00",
      "icms_base_calculo":        100.00,
      "icms_aliquota":            12.00,
      "icms_valor":               12.00,
      "pis_cst":                  "01",
      "pis_base_calculo":         100.00,
      "pis_aliquota_percentual":  0.65,
      "pis_valor":                0.65,
      "cofins_cst":               "01",
      "cofins_base_calculo":      100.00,
      "cofins_aliquota_percentual": 3.00,
      "cofins_valor":             3.00
    }
  ],
  "pagamentos": [
    { "forma_pagamento": "99", "valor_pagamento": 100.00 }
  ]
}
EOF
)

  step "Enviando para SQS..."
  echo -e "  focus_ref  : ${CYAN}${FOCUS_REF}${NC}"
  echo -e "  invoice_id : ${CYAN}${INVOICE_ID}${NC}"

  MSG_ID=$(aws sqs send-message \
    --queue-url "$URL_REQ" \
    --message-body "$PAYLOAD" \
    --region "$REGION" \
    --query MessageId --output text)
  ok "Mensagem enviada! MessageId: $MSG_ID"

  step "Aguardando resultado na fila nfe-results (timeout: 90s)..."
  DEADLINE=$((TIMESTAMP + 90))
  FOUND=0

  while [[ $(date +%s) -lt $DEADLINE ]]; do
    MSGS=$(aws sqs receive-message \
      --queue-url "$URL_RES" \
      --max-number-of-messages 10 \
      --wait-time-seconds 5 \
      --visibility-timeout 30 \
      --region "$REGION" \
      --output json 2>/dev/null || echo '{}')

    COUNT=$(echo "$MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('Messages',[])))" 2>/dev/null || echo 0)

    if [[ "$COUNT" -gt 0 ]]; then
      for i in $(seq 0 $((COUNT - 1))); do
        BODY=$(echo "$MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Messages'][$i]['Body'])")
        RECEIPT=$(echo "$MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Messages'][$i]['ReceiptHandle'])")
        MSG_INV=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('invoice_id',''))")

        if [[ "$MSG_INV" == "$INVOICE_ID" ]]; then
          NFE_STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nfe_status',''))")
          echo ""
          echo -e "  ┌─ RESULTADO ────────────────────────────────────────"
          echo -e "  │  invoice_id : ${CYAN}${INVOICE_ID}${NC}"

          if [[ "$NFE_STATUS" == "authorized" ]]; then
            NFE_CHAVE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nfe_chave',''))")
            NFE_PROT=$(echo "$BODY"  | python3 -c "import sys,json; print(json.load(sys.stdin).get('nfe_protocol',''))")
            NFE_DATE=$(echo "$BODY"  | python3 -c "import sys,json; print(json.load(sys.stdin).get('nfe_auth_date',''))")
            DANFE=$(echo "$BODY"     | python3 -c "import sys,json; print(json.load(sys.stdin).get('danfe_url',''))")
            XML_KEY=$(echo "$BODY"   | python3 -c "import sys,json; print(json.load(sys.stdin).get('xml_s3_key',''))")
            echo -e "  │  status     : ${GREEN}AUTORIZADO ✓${NC}"
            echo -e "  │  chave      : ${GREEN}${NFE_CHAVE}${NC}"
            echo -e "  │  protocolo  : $NFE_PROT"
            echo -e "  │  auth_date  : $NFE_DATE"
            [[ -n "$DANFE"   ]] && echo -e "  │  DANFE URL  : ${CYAN}${DANFE}${NC}"
            [[ -n "$XML_KEY" ]] && echo -e "  │  XML S3     : ${CYAN}s3://${S3_BUCKET}/${XML_KEY}${NC}"
          else
            REASON=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nfe_reject_reason',''))")
            echo -e "  │  status     : ${RED}${NFE_STATUS^^} ✗${NC}"
            [[ -n "$REASON" ]] && echo -e "  │  motivo     : ${RED}${REASON}${NC}"
          fi
          echo -e "  └────────────────────────────────────────────────────"

          # Remove a mensagem processada da fila
          aws sqs delete-message \
            --queue-url "$URL_RES" \
            --receipt-handle "$RECEIPT" \
            --region "$REGION" > /dev/null
          FOUND=1
          break
        else
          # Não é nossa mensagem — devolve à fila
          aws sqs change-message-visibility \
            --queue-url "$URL_RES" \
            --receipt-handle "$RECEIPT" \
            --visibility-timeout 0 \
            --region "$REGION" > /dev/null 2>&1 || true
        fi
      done
    fi

    [[ "$FOUND" == "1" ]] && break
    REMAINING=$((DEADLINE - $(date +%s)))
    echo -e "  ${GRAY}Aguardando... (${REMAINING}s restantes)${NC}"
  done

  if [[ "$FOUND" == "0" ]]; then
    fail "Timeout 90s — resultado não chegou na fila nfe-results."
    warn "Verifique a opção 3 (logs ao vivo) ou a opção 5 (DLQ) para diagnosticar."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 2 — Status das filas e Lambda
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "2" ]]; then
  header "Status dos recursos NF-e"

  step "Profundidade das filas SQS..."
  get_depth() {
    aws sqs get-queue-attributes \
      --queue-url "$1" \
      --attribute-names ApproximateNumberOfMessages \
      --region "$REGION" \
      --query 'Attributes.ApproximateNumberOfMessages' --output text
  }
  D_REQ=$(get_depth "$URL_REQ")
  D_RES=$(get_depth "$URL_RES")
  D_DLQ=$(get_depth "$URL_DLQ")

  echo -e "  nfe-requests : ${YELLOW}${D_REQ} msg${NC}"
  echo -e "  nfe-results  : ${GREEN}${D_RES} msg${NC}"
  if [[ "$D_DLQ" -gt 0 ]]; then
    echo -e "  nfe-dlq      : ${RED}${D_DLQ} msg ← ATENÇÃO: falhas na DLQ!${NC}"
  else
    echo -e "  nfe-dlq      : ${GREEN}0 (ok)${NC}"
  fi

  step "Configuração do Lambda ${LAMBDA_NAME}..."
  aws lambda get-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --region "$REGION" \
    --query '{State:State,LastModified:LastModified,Timeout:Timeout,MemorySize:MemorySize,ImageUri:Code.ImageUri}' \
    --output table

  step "Event Source Mapping (SQS → Lambda)..."
  aws lambda list-event-source-mappings \
    --function-name "$LAMBDA_NAME" \
    --region "$REGION" \
    --query 'EventSourceMappings[].{Estado:State,BatchSize:BatchSize,Fila:EventSourceArn}' \
    --output table
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 3 — Logs ao vivo do Lambda
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "3" ]]; then
  header "Logs do Lambda (últimas 50 linhas)"

  STREAM=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --order-by LastEventTime \
    --descending \
    --max-items 1 \
    --region "$REGION" \
    --query 'logStreams[0].logStreamName' --output text 2>/dev/null || echo "")

  if [[ -z "$STREAM" || "$STREAM" == "None" ]]; then
    warn "Nenhum log stream encontrado. Lambda ainda não foi invocado?"
  else
    ok "Stream: $STREAM"
    aws logs get-log-events \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$STREAM" \
      --limit 50 \
      --start-from-head false \
      --region "$REGION" \
      --query 'events[*].[timestamp,message]' \
      --output text | while IFS=$'\t' read -r ts msg; do
        MSG_CLEAN=$(echo "$msg" | tr -d '\r')
        if echo "$MSG_CLEAN" | grep -qiE 'nfe_authorized|autorizado'; then
          echo -e "${GREEN}  $MSG_CLEAN${NC}"
        elif echo "$MSG_CLEAN" | grep -qiE 'ERROR|WARN|rejected|error'; then
          echo -e "${RED}  $MSG_CLEAN${NC}"
        elif echo "$MSG_CLEAN" | grep -qiE 'nfe_start|nfe_submitted'; then
          echo -e "${YELLOW}  $MSG_CLEAN${NC}"
        else
          echo -e "${GRAY}  $MSG_CLEAN${NC}"
        fi
      done

    echo ""
    echo -e "${CYAN}Para tail ao vivo, execute em outra aba do CloudShell:${NC}"
    echo "  aws logs tail $LOG_GROUP --follow --region $REGION"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 4 — Ler mensagens da nfe-results
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "4" ]]; then
  header "Mensagens na fila nfe-results (sem deletar)"

  MSGS=$(aws sqs receive-message \
    --queue-url "$URL_RES" \
    --max-number-of-messages 10 \
    --wait-time-seconds 5 \
    --visibility-timeout 0 \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{}')

  COUNT=$(echo "$MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('Messages',[])))" 2>/dev/null || echo 0)

  if [[ "$COUNT" == "0" ]]; then
    warn "Nenhuma mensagem na fila nfe-results no momento."
  else
    ok "${COUNT} mensagem(s) encontrada(s):"
    echo "$MSGS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i, m in enumerate(d.get('Messages', [])):
    body = json.loads(m['Body'])
    print(f\"  [{i+1}] invoice_id  : {body.get('invoice_id','?')}\")
    print(f\"      nfe_status  : {body.get('nfe_status','?')}\")
    if body.get('nfe_chave'):   print(f\"      nfe_chave   : {body['nfe_chave']}\")
    if body.get('nfe_protocol'):print(f\"      protocolo   : {body['nfe_protocol']}\")
    if body.get('danfe_url'):   print(f\"      DANFE URL   : {body['danfe_url']}\")
    if body.get('nfe_reject_reason'): print(f\"      motivo      : {body['nfe_reject_reason']}\")
    print()
"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 5 — Ler mensagens da DLQ
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "5" ]]; then
  header "Mensagens na DLQ (falhas 3×)"

  MSGS=$(aws sqs receive-message \
    --queue-url "$URL_DLQ" \
    --max-number-of-messages 5 \
    --wait-time-seconds 3 \
    --visibility-timeout 0 \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{}')

  COUNT=$(echo "$MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('Messages',[])))" 2>/dev/null || echo 0)

  if [[ "$COUNT" == "0" ]]; then
    ok "DLQ vazia — nenhuma falha registrada."
  else
    fail "${COUNT} mensagem(s) na DLQ:"
    echo "$MSGS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i, m in enumerate(d.get('Messages', [])):
    print(f'  [{i+1}] ReceiptHandle: {m[\"ReceiptHandle\"][:40]}...')
    try:
        body = json.loads(m['Body'])
        print(f'      invoice_id: {body.get(\"invoice_id\",\"?\")}')
        print(f'      focus_ref : {body.get(\"focus_ref\",\"?\")}')
    except:
        print(f'      body raw  : {m[\"Body\"][:200]}')
    print()
"
    warn "Para reprocessar manualmente, use a opção 6 (invocar Lambda com payload direto)."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 6 — Invocar Lambda diretamente (síncrono, sem SQS)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "6" ]]; then
  header "Invocação direta do Lambda (modo síncrono)"

  TIMESTAMP=$(date +%s)
  INVOICE_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  TENANT_ID=$(cat /proc/sys/kernel/random/uuid  2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  FOCUS_REF="DIRECT-LAMBDA-${TIMESTAMP}"
  DATA_EMISSAO=$(date -u +"%Y-%m-%dT%H:%M:%S-03:00")

  # O Lambda espera um evento SQS com a mensagem dentro de Records[0].body
  SQS_EVENT=$(cat <<EOF
{
  "Records": [
    {
      "messageId": "test-${TIMESTAMP}",
      "receiptHandle": "mock-receipt",
      "body": "{\"invoice_id\":\"${INVOICE_ID}\",\"tenant_id\":\"${TENANT_ID}\",\"focus_ref\":\"${FOCUS_REF}\",\"ambiente\":2,\"emitente\":{\"cnpj\":\"11444777000161\",\"razao_social\":\"EMPRESA TESTE GAX ERP LTDA\",\"logradouro\":\"Rua das Acacias\",\"numero\":\"100\",\"bairro\":\"Centro\",\"municipio\":\"SAO PAULO\",\"uf\":\"SP\",\"cep\":\"01310100\",\"regime_tributario\":2},\"destinatario\":{\"cnpj\":\"07504505000132\",\"nome\":\"EMPRESA DESTINO TESTE LTDA\",\"indicador_ie\":9,\"logradouro\":\"Av. Paulista\",\"numero\":\"1000\",\"bairro\":\"Bela Vista\",\"municipio\":\"SAO PAULO\",\"uf\":\"SP\",\"cep\":\"01310100\"},\"natureza_operacao\":\"Venda de mercadoria\",\"data_emissao\":\"${DATA_EMISSAO}\",\"itens\":[{\"numero_item\":1,\"codigo_produto\":\"PROD-TESTE-001\",\"descricao\":\"Produto Teste Homologacao\",\"ncm\":\"73181500\",\"cfop\":\"5102\",\"unidade_comercial\":\"UN\",\"quantidade_comercial\":1,\"valor_unitario_comercial\":100.00,\"valor_bruto\":100.00,\"icms_cst\":\"00\",\"icms_base_calculo\":100.00,\"icms_aliquota\":12.00,\"icms_valor\":12.00,\"pis_cst\":\"01\",\"pis_base_calculo\":100.00,\"pis_aliquota_percentual\":0.65,\"pis_valor\":0.65,\"cofins_cst\":\"01\",\"cofins_base_calculo\":100.00,\"cofins_aliquota_percentual\":3.00,\"cofins_valor\":3.00}],\"pagamentos\":[{\"forma_pagamento\":\"99\",\"valor_pagamento\":100.00}]}",
      "attributes": { "ApproximateReceiveCount": "1", "SentTimestamp": "${TIMESTAMP}000", "SenderId": "CloudShell", "ApproximateFirstReceiveTimestamp": "${TIMESTAMP}000" },
      "messageAttributes": {},
      "md5OfBody": "mock",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${QUEUE_REQ}",
      "awsRegion": "${REGION}"
    }
  ]
}
EOF
)

  step "Invocando Lambda ${LAMBDA_NAME} de forma síncrona..."
  echo -e "  focus_ref  : ${CYAN}${FOCUS_REF}${NC}"
  echo -e "  invoice_id : ${CYAN}${INVOICE_ID}${NC}"
  warn "Timeout do Lambda é 270s — aguarde..."

  RESPONSE_FILE="/tmp/lambda-response-${TIMESTAMP}.json"

  aws lambda invoke \
    --function-name "$LAMBDA_NAME" \
    --payload "$(echo "$SQS_EVENT" | base64 -w 0)" \
    --cli-binary-format raw-in-base64-out \
    --region "$REGION" \
    --log-type Tail \
    "$RESPONSE_FILE" > /tmp/lambda-meta-${TIMESTAMP}.json

  STATUS_CODE=$(cat /tmp/lambda-meta-${TIMESTAMP}.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('StatusCode','?'))")
  ok "StatusCode HTTP: $STATUS_CODE"

  step "Resposta do Lambda:"
  cat "$RESPONSE_FILE" | python3 -m json.tool 2>/dev/null || cat "$RESPONSE_FILE"

  step "Log tail (últimas linhas do Lambda):"
  LOG_RESULT=$(cat /tmp/lambda-meta-${TIMESTAMP}.json | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d.get('LogResult','')).decode('utf-8','ignore'))" 2>/dev/null || echo "")
  if [[ -n "$LOG_RESULT" ]]; then
    echo "$LOG_RESULT" | while IFS= read -r line; do
      if echo "$line" | grep -qiE 'nfe_authorized|autorizado'; then
        echo -e "${GREEN}  $line${NC}"
      elif echo "$line" | grep -qiE 'ERROR|WARN|rejected'; then
        echo -e "${RED}  $line${NC}"
      else
        echo -e "${GRAY}  $line${NC}"
      fi
    done
  fi

  step "Verificando resultado na fila nfe-results (aguardando 10s)..."
  sleep 5
  RESULT_MSG=$(aws sqs receive-message \
    --queue-url "$URL_RES" \
    --max-number-of-messages 5 \
    --wait-time-seconds 5 \
    --visibility-timeout 0 \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{}')
  COUNT_R=$(echo "$RESULT_MSG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('Messages',[])))" 2>/dev/null || echo 0)
  if [[ "$COUNT_R" -gt 0 ]]; then
    ok "Resultado encontrado na fila nfe-results:"
    echo "$RESULT_MSG" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('Messages', []):
    b = json.loads(m['Body'])
    print(f'  status     : {b.get(\"nfe_status\",\"?\")}')
    if b.get('nfe_chave'):          print(f'  chave      : {b[\"nfe_chave\"]}')
    if b.get('nfe_protocol'):       print(f'  protocolo  : {b[\"nfe_protocol\"]}')
    if b.get('danfe_url'):          print(f'  DANFE URL  : {b[\"danfe_url\"]}')
    if b.get('nfe_reject_reason'):  print(f'  motivo     : {b[\"nfe_reject_reason\"]}')
"
  else
    warn "Resultado ainda não apareceu na fila nfe-results."
    echo "  Use a opção 4 em alguns segundos para verificar."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Opção 7 — Purge da fila nfe-results
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$OPC" == "7" ]]; then
  header "Limpar fila nfe-results"
  read -rp "  Tem certeza? Todas as mensagens serão apagadas. [s/N]: " CONF
  if [[ "${CONF,,}" == "s" ]]; then
    aws sqs purge-queue --queue-url "$URL_RES" --region "$REGION"
    ok "Fila nfe-results limpa."
  else
    warn "Cancelado."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GRAY}── Referência rápida ────────────────────────────────────────────────────${NC}"
echo -e "  Lambda logs ao vivo   : aws logs tail ${LOG_GROUP} --follow --region ${REGION}"
echo -e "  Depth nfe-requests    : aws sqs get-queue-attributes --queue-url ${URL_REQ} --attribute-names ApproximateNumberOfMessages --region ${REGION}"
echo -e "  Depth nfe-dlq         : aws sqs get-queue-attributes --queue-url ${URL_DLQ} --attribute-names ApproximateNumberOfMessages --region ${REGION}"
echo -e "  S3 bucket XMLs        : aws s3 ls s3://${S3_BUCKET}/ --region ${REGION}"
echo ""

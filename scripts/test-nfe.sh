#!/usr/bin/env bash
set -euo pipefail

# Test helper to exercise NF-e flow locally using Docker Compose + API
# Steps:
# 1) start db + localstack
# 2) run migrations
# 3) start services (api-core + lambdas + backoffice)
# 4) run seed and capture TENANT_ID
# 5) create a client, create an invoice, call emit
# 6) tail lambda-fiscal logs

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' is required but not installed." >&2; exit 2; }
}

require_cmd docker
require_cmd jq

echo "[1/7] Starting Postgres and LocalStack..."
docker compose up -d db localstack

echo "[2/7] Running migrations (profile: migrate)..."
docker compose --profile migrate run --rm migrate

echo "[3/7] Starting api-core and lambda runners..."
docker compose up -d api-core lambda-fiscal lambda-notifications lambda-billing backoffice

echo "[4/7] Running seed to create tenant/admin (capturing Tenant ID)..."
SEED_LOG="/tmp/erp_seed_$(date +%s).log"
docker compose exec -T api-core npm run seed | tee "$SEED_LOG"
TENANT_ID=$(grep -E "Tenant ID" "$SEED_LOG" | head -n1 | awk -F': ' '{print $2}' | tr -d '[:space:]')

if [ -z "$TENANT_ID" ]; then
  echo "ERROR: Tenant ID not found in seed output. Check container logs: docker compose logs api-core" >&2
  exit 3
fi

echo "Tenant ID: $TENANT_ID"

echo "[5/7] Creating a test client..."
CREATE_CLIENT_RESP=$(curl -s -X POST http://localhost:3001/v1/clients \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"person_type\":\"PJ\",\"company_name\":\"Cliente Teste\",\"cnpj\":\"11444777000161\",\"zip_code\":\"01001000\",\"street\":\"Rua Teste\",\"street_number\":\"100\",\"neighborhood\":\"Centro\",\"city\":\"SAO PAULO\",\"state\":\"SP\",\"email\":\"cliente@exemplo.com\"}")
CLIENT_ID=$(echo "$CREATE_CLIENT_RESP" | jq -r '.id // .rows?.[0]?.id // empty')
if [ -z "$CLIENT_ID" ]; then
  echo "Failed to create client. Response:" >&2
  echo "$CREATE_CLIENT_RESP" >&2
  exit 4
fi
echo "Client ID: $CLIENT_ID"

echo "[6/7] Creating an invoice (draft)..."
CREATE_INV_RESP=$(curl -s -X POST http://localhost:3001/v1/invoices \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"${TENANT_ID}\",\"client_id\":\"${CLIENT_ID}\",\"items\":[{\"name\":\"Produto A\",\"ncm_code\":\"6109.10.00\",\"quantity\":1,\"unit_price\":100}]}" )
INVOICE_ID=$(echo "$CREATE_INV_RESP" | jq -r '.id // .rows?.[0]?.id // empty')
if [ -z "$INVOICE_ID" ]; then
  echo "Failed to create invoice. Response:" >&2
  echo "$CREATE_INV_RESP" >&2
  exit 5
fi
echo "Invoice ID: $INVOICE_ID"

echo "[7/7] Sending emit request to /v1/invoices/:id/emit (async)..."
curl -s -X POST "http://localhost:3001/v1/invoices/${INVOICE_ID}/emit?tenant_id=${TENANT_ID}" -o /tmp/emit_response.json
echo "Emit response:" && cat /tmp/emit_response.json | jq . || true

echo "Now tailing lambda-fiscal logs (press CTRL+C to stop)..."
docker compose logs -f lambda-fiscal

exit 0

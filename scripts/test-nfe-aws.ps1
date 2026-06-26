#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    GAX ERP — NF-e integration test script (AWS homologação)

.DESCRIPTION
    Três modos de operação:
      api        — Fluxo completo via CloudFront (login → config → invoice → emit → poll)
      direct-sqs — Injeta mensagem diretamente no SQS nfe-requests (bypass da API)
      monitor    — Apenas monitora filas, Lambda e CloudWatch logs

.PARAMETER Mode
    Modo de execução: api | direct-sqs | monitor  (padrão: api)

.PARAMETER ApiUrl
    URL do CloudFront (ex: https://abc123.cloudfront.net).
    Obrigatório em modo api. Ignorado nos demais modos.

.PARAMETER Email
    E-mail de login. Obrigatório em modo api.

.PARAMETER Password
    Senha de login. Obrigatório em modo api.

.PARAMETER Region
    Região AWS (padrão: us-east-1)

.PARAMETER EnvName
    Nome do ambiente Terraform (padrão: prod)

.EXAMPLE
    # Modo API — teste completo end-to-end
    .\scripts\test-nfe-aws.ps1 -Mode api `
        -ApiUrl https://abc123.cloudfront.net `
        -Email admin@suaempresa.com -Password "SuaSenha"

    # Modo SQS direto — injeta payload sem passar pela API
    .\scripts\test-nfe-aws.ps1 -Mode direct-sqs

    # Apenas monitorar filas e logs
    .\scripts\test-nfe-aws.ps1 -Mode monitor
#>
[CmdletBinding()]
param(
    [ValidateSet('api', 'direct-sqs', 'monitor')]
    [string]$Mode = 'api',

    [string]$ApiUrl   = $env:ERP_API_URL,
    [string]$Email    = $env:ERP_EMAIL,
    [string]$Password = $env:ERP_PASSWORD,

    [string]$Region  = 'us-east-1',
    [string]$EnvName = 'prod'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Header([string]$text) {
    Write-Host "`n$('─' * 60)" -ForegroundColor DarkGray
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "$('─' * 60)" -ForegroundColor DarkGray
}

function Write-Step([string]$text) {
    Write-Host "`n▶  $text" -ForegroundColor Yellow
}

function Write-OK([string]$text) {
    Write-Host "   ✓  $text" -ForegroundColor Green
}

function Write-Warn([string]$text) {
    Write-Host "   ⚠  $text" -ForegroundColor Magenta
}

function Write-Fail([string]$text) {
    Write-Host "   ✗  $text" -ForegroundColor Red
}

function Invoke-Aws {
    param([string[]]$Args)
    $out = aws @Args --region $Region --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI error: $out" }
    return $out | ConvertFrom-Json
}

function Get-SqsUrl([string]$QueueName) {
    $r = Invoke-Aws @('sqs', 'get-queue-url', '--queue-name', $QueueName)
    return $r.QueueUrl
}

function Get-QueueDepth([string]$Url) {
    $r = Invoke-Aws @('sqs', 'get-queue-attributes',
        '--queue-url', $Url,
        '--attribute-names', 'ApproximateNumberOfMessages')
    return [int]$r.Attributes.ApproximateNumberOfMessages
}

# ── Descoberta de recursos AWS ────────────────────────────────────────────────

Write-Header "GAX ERP — Teste de Integração NF-e (modo: $Mode)"

Write-Step "Verificando credenciais AWS..."
try {
    $identity = Invoke-Aws @('sts', 'get-caller-identity')
    $AccountId = $identity.Account
    Write-OK "Account: $AccountId | ARN: $($identity.Arn)"
} catch {
    Write-Fail "Credenciais AWS não configuradas. Execute: aws configure"
    exit 1
}

# Nomes dos recursos (espelham o Terraform)
$LambdaName   = "erp-lite-fiscal-nfe-$EnvName"
$QueueReq     = "erp-lite-nfe-requests-$EnvName"
$QueueRes     = "erp-lite-nfe-results-$EnvName"
$QueueDlq     = "erp-lite-nfe-dlq-$EnvName"
$S3Bucket     = "erp-lite-nfe-$EnvName-$AccountId"
$LogGroupLambda = "/aws/lambda/$LambdaName"

Write-Step "Resolvendo URLs das filas SQS..."
try {
    $UrlReq = Get-SqsUrl $QueueReq
    $UrlRes = Get-SqsUrl $QueueRes
    $UrlDlq = Get-SqsUrl $QueueDlq
    Write-OK "nfe-requests : $UrlReq"
    Write-OK "nfe-results  : $UrlRes"
    Write-OK "nfe-dlq      : $UrlDlq"
} catch {
    Write-Fail "Falha ao resolver filas SQS: $_"
    Write-Warn "Verifique se o ambiente '$EnvName' está deployado e as credenciais têm permissão sqs:GetQueueUrl"
    exit 1
}

# ── MODO: monitor ─────────────────────────────────────────────────────────────

function Invoke-Monitor {
    Write-Header "Status atual dos recursos NF-e"

    Write-Step "Profundidade das filas SQS..."
    $depReq = Get-QueueDepth $UrlReq
    $depRes = Get-QueueDepth $UrlRes
    $depDlq = Get-QueueDepth $UrlDlq

    Write-Host "   nfe-requests : " -NoNewline
    Write-Host $depReq -ForegroundColor $(if ($depReq -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "   nfe-results  : " -NoNewline
    Write-Host $depRes -ForegroundColor $(if ($depRes -gt 0) { 'Green' } else { 'Gray' })
    Write-Host "   nfe-dlq      : " -NoNewline
    if ($depDlq -gt 0) {
        Write-Host $depDlq -ForegroundColor Red
        Write-Warn "DLQ com mensagens! NF-es falharam 3×. Ver logs abaixo."
    } else {
        Write-Host "0 (ok)" -ForegroundColor Green
    }

    Write-Step "Configuração do Lambda $LambdaName..."
    try {
        $fn = Invoke-Aws @('lambda', 'get-function-configuration', '--function-name', $LambdaName)
        Write-OK "Estado       : $($fn.State)"
        Write-OK "Última modif.: $($fn.LastModified)"
        Write-OK "Timeout      : $($fn.Timeout)s | Memória: $($fn.MemorySize)MB"
        Write-OK "Imagem       : $($fn.Code.ImageUri ?? $fn.Handler)"
    } catch {
        Write-Fail "Lambda não encontrado: $LambdaName — $_"
    }

    Write-Step "Últimas 20 invocações do Lambda (CloudWatch)..."
    try {
        $streams = Invoke-Aws @('logs', 'describe-log-streams',
            '--log-group-name', $LogGroupLambda,
            '--order-by', 'LastEventTime',
            '--descending',
            '--max-items', '3')

        foreach ($stream in $streams.logStreams) {
            Write-Host "`n   Stream: $($stream.logStreamName)" -ForegroundColor DarkGray
            $events = Invoke-Aws @('logs', 'get-log-events',
                '--log-group-name', $LogGroupLambda,
                '--log-stream-name', $stream.logStreamName,
                '--limit', '20',
                '--start-from-head', 'false')

            foreach ($ev in $events.events | Select-Object -Last 10) {
                $ts   = [DateTimeOffset]::FromUnixTimeMilliseconds($ev.timestamp).LocalDateTime.ToString('HH:mm:ss')
                $line = $ev.message.Trim()
                $color = if ($line -match 'nfe_authorized|autorizado') { 'Green' }
                         elseif ($line -match 'ERROR|error|nfe_rejected|WARN') { 'Red' }
                         elseif ($line -match 'nfe_start|nfe_submitted') { 'Yellow' }
                         else { 'Gray' }
                Write-Host "   $ts  $line" -ForegroundColor $color
            }
        }
    } catch {
        Write-Warn "Não foi possível ler CloudWatch logs: $_"
    }

    Write-Step "Mensagens pendentes na nfe-results (leitura sem deletar)..."
    $msgs = Invoke-Aws @('sqs', 'receive-message',
        '--queue-url', $UrlRes,
        '--max-number-of-messages', '5',
        '--visibility-timeout', '0',
        '--wait-time-seconds', '3')

    if ($msgs.Messages) {
        foreach ($m in $msgs.Messages) {
            $body = $m.Body | ConvertFrom-Json
            Write-Host "   InvoiceId: $($body.invoice_id)" -ForegroundColor Cyan
            Write-Host "   Status   : $($body.nfe_status)" -ForegroundColor $(
                if ($body.nfe_status -eq 'authorized') { 'Green' } else { 'Red' })
            if ($body.nfe_chave)        { Write-OK "Chave    : $($body.nfe_chave)" }
            if ($body.nfe_reject_reason){ Write-Fail "Motivo   : $($body.nfe_reject_reason)" }
            if ($body.danfe_url)        { Write-OK "DANFE    : $($body.danfe_url)" }
            Write-Host ""
        }
    } else {
        Write-Host "   Nenhuma mensagem na fila nfe-results no momento." -ForegroundColor Gray
    }
}

# ── MODO: direct-sqs ─────────────────────────────────────────────────────────

function Invoke-DirectSqs {
    Write-Header "Teste direto via SQS (bypass da API)"
    Write-Warn "Este modo injeta um payload NF-e fictício diretamente na fila nfe-requests."
    Write-Warn "O Lambda processará e tentará emitir na Focus NF-e (homologação)."

    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $invoiceId = [guid]::NewGuid().ToString()
    $tenantId  = [guid]::NewGuid().ToString()
    $focusRef  = "TEST-$timestamp"
    $dataEmissao = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss") + "-03:00"

    $payload = @{
        invoice_id = $invoiceId
        tenant_id  = $tenantId
        focus_ref  = $focusRef
        ambiente   = 2   # homologação

        emitente = @{
            cnpj              = "11444777000161"
            razao_social      = "EMPRESA TESTE GAX ERP LTDA"
            logradouro        = "Rua das Acácias"
            numero            = "100"
            complemento       = "Sala 1"
            bairro            = "Centro"
            municipio         = "SAO PAULO"
            uf                = "SP"
            cep               = "01310100"
            telefone          = "11999990000"
            email             = "fiscal@teste.com.br"
            regime_tributario = 2   # Lucro Presumido
        }

        destinatario = @{
            cnpj        = "07504505000132"
            nome        = "EMPRESA DESTINO TESTE LTDA"
            indicador_ie = 9
            logradouro  = "Av. Paulista"
            numero      = "1000"
            bairro      = "Bela Vista"
            municipio   = "SAO PAULO"
            uf          = "SP"
            cep         = "01310100"
            email       = "destino@teste.com"
        }

        natureza_operacao = "Venda de mercadoria"
        data_emissao      = $dataEmissao

        itens = @(
            @{
                numero_item              = 1
                codigo_produto           = "PROD-TESTE-001"
                descricao                = "Produto de Teste Homologacao GAX ERP"
                ncm                      = "73181500"
                cfop                     = "5102"
                unidade_comercial        = "UN"
                quantidade_comercial     = 1
                valor_unitario_comercial = 100.00
                valor_bruto              = 100.00
                icms_cst                 = "00"
                icms_base_calculo        = 100.00
                icms_aliquota            = 12.00
                icms_valor               = 12.00
                pis_cst                  = "01"
                pis_base_calculo         = 100.00
                pis_aliquota_percentual  = 0.65
                pis_valor                = 0.65
                cofins_cst               = "01"
                cofins_base_calculo      = 100.00
                cofins_aliquota_percentual = 3.00
                cofins_valor             = 3.00
            }
        )

        pagamentos = @(
            @{
                forma_pagamento = "99"  # outros
                valor_pagamento = 100.00
            }
        )
    }

    $body = $payload | ConvertTo-Json -Depth 10 -Compress

    Write-Step "Payload preparado:"
    Write-Host "   focus_ref  : $focusRef" -ForegroundColor Cyan
    Write-Host "   invoice_id : $invoiceId" -ForegroundColor Cyan
    Write-Host "   ambiente   : 2 (homologação)" -ForegroundColor Cyan

    Write-Step "Enviando mensagem para SQS nfe-requests..."
    $sendResult = Invoke-Aws @('sqs', 'send-message',
        '--queue-url', $UrlReq,
        '--message-body', $body)
    Write-OK "MessageId: $($sendResult.MessageId)"

    Write-Step "Aguardando Lambda processar (polling nfe-results por até 90s)..."
    $deadline = (Get-Date).AddSeconds(90)
    $found = $false

    while ((Get-Date) -lt $deadline) {
        $msgs = Invoke-Aws @('sqs', 'receive-message',
            '--queue-url', $UrlRes,
            '--max-number-of-messages', '10',
            '--wait-time-seconds', '5',
            '--visibility-timeout', '30')

        foreach ($m in ($msgs.Messages ?? @())) {
            $r = $m.Body | ConvertFrom-Json

            if ($r.invoice_id -eq $invoiceId) {
                Write-Host "`n" -NoNewline
                Write-Host "   ┌─ RESULTADO ──────────────────────────────────────" -ForegroundColor DarkGray
                Write-Host "   │  invoice_id : $($r.invoice_id)" -ForegroundColor White
                Write-Host "   │  status     : " -NoNewline -ForegroundColor White

                if ($r.nfe_status -eq 'authorized') {
                    Write-Host "AUTORIZADO ✓" -ForegroundColor Green
                    Write-Host "   │  chave      : $($r.nfe_chave)" -ForegroundColor Green
                    Write-Host "   │  protocolo  : $($r.nfe_protocol)" -ForegroundColor Green
                    Write-Host "   │  auth_date  : $($r.nfe_auth_date)" -ForegroundColor Green
                    if ($r.danfe_url) {
                        Write-Host "   │  DANFE      : $($r.danfe_url)" -ForegroundColor Cyan
                    }
                    if ($r.xml_s3_key) {
                        Write-Host "   │  XML S3     : s3://$S3Bucket/$($r.xml_s3_key)" -ForegroundColor Cyan
                    }
                } else {
                    Write-Host "$($r.nfe_status.ToUpper()) ✗" -ForegroundColor Red
                    if ($r.nfe_reject_reason) {
                        Write-Host "   │  motivo     : $($r.nfe_reject_reason)" -ForegroundColor Red
                    }
                }

                Write-Host "   └──────────────────────────────────────────────────" -ForegroundColor DarkGray

                # Deleta a mensagem da fila após processar
                Invoke-Aws @('sqs', 'delete-message',
                    '--queue-url', $UrlRes,
                    '--receipt-handle', $m.ReceiptHandle) | Out-Null

                $found = $true
                break
            } else {
                # Mensagem de outro teste — devolve à fila
                Invoke-Aws @('sqs', 'change-message-visibility',
                    '--queue-url', $UrlRes,
                    '--receipt-handle', $m.ReceiptHandle,
                    '--visibility-timeout', '0') | Out-Null
            }
        }

        if ($found) { break }

        $remaining = [int](($deadline - (Get-Date)).TotalSeconds)
        Write-Host "   Aguardando resultado... ($remaining s restantes)" -ForegroundColor DarkGray
    }

    if (-not $found) {
        Write-Fail "Timeout: resultado não chegou em 90s."
        Write-Warn "Verifique os logs do Lambda:"
        Write-Host "   aws logs tail $LogGroupLambda --follow --region $Region" -ForegroundColor Cyan

        Write-Step "Verificando DLQ..."
        $dlqDepth = Get-QueueDepth $UrlDlq
        if ($dlqDepth -gt 0) {
            Write-Fail "DLQ com $dlqDepth mensagem(s) — Lambda falhou 3×."
            Write-Warn "Leia a DLQ para ver o erro:"
            Write-Host "   aws sqs receive-message --queue-url $UrlDlq --region $Region" -ForegroundColor Cyan
        }
    }

    Write-Step "Logs recentes do Lambda (últimas 30 linhas)..."
    Show-LambdaLogs -Lines 30
}

# ── MODO: api (end-to-end completo) ──────────────────────────────────────────

function Invoke-ApiTest {
    if (-not $ApiUrl)   { Write-Fail "-ApiUrl é obrigatório no modo api"; exit 1 }
    if (-not $Email)    { Write-Fail "-Email é obrigatório no modo api";   exit 1 }
    if (-not $Password) { Write-Fail "-Password é obrigatório no modo api"; exit 1 }

    $base = $ApiUrl.TrimEnd('/')
    $headers = @{ 'Content-Type' = 'application/json' }

    function api-post([string]$path, [hashtable]$body, [string]$token = '') {
        $h = $headers.Clone()
        if ($token) { $h['Authorization'] = "Bearer $token" }
        return Invoke-RestMethod -Method POST -Uri "$base$path" -Headers $h `
            -Body ($body | ConvertTo-Json -Depth 10) -ErrorAction Stop
    }

    function api-get([string]$path, [string]$token) {
        $h = $headers.Clone()
        $h['Authorization'] = "Bearer $token"
        return Invoke-RestMethod -Method GET -Uri "$base$path" -Headers $h -ErrorAction Stop
    }

    function api-put([string]$path, [hashtable]$body, [string]$token) {
        $h = $headers.Clone()
        $h['Authorization'] = "Bearer $token"
        return Invoke-RestMethod -Method PUT -Uri "$base$path" -Headers $h `
            -Body ($body | ConvertTo-Json -Depth 10) -ErrorAction Stop
    }

    Write-Header "Teste end-to-end via API — $base"

    # ── 1. Login ──────────────────────────────────────────────────────────────
    Write-Step "1/6 — Login ($Email)..."
    try {
        $auth = api-post '/v1/auth/login' @{ email = $Email; password = $Password }
        $jwt  = $auth.token
        Write-OK "JWT obtido (expira em: $($auth.expires_at ?? 'N/A'))"
    } catch {
        Write-Fail "Falha no login: $_"
        exit 1
    }

    # ── 2. Configurar emitente ────────────────────────────────────────────────
    Write-Step "2/6 — Configurando nfe_configs (emitente + ambiente=2)..."
    try {
        api-put '/v1/nfe-config' @{
            cnpj               = "11444777000161"
            razao_social       = "EMPRESA TESTE GAX ERP LTDA"
            regime_tributario  = 2
            logradouro         = "Rua das Acacias"
            numero             = "100"
            bairro             = "Centro"
            municipio          = "SAO PAULO"
            uf                 = "SP"
            cep                = "01310100"
            telefone           = "11999990000"
            email              = "fiscal@teste.com.br"
            cfop_padrao        = "5102"
            cfop_interestadual = "6102"
            natureza_operacao  = "Venda de mercadoria"
            focus_ambiente     = 2
        } -token $jwt | Out-Null
        Write-OK "nfe_configs salvo com focus_ambiente=2 (homologação)"
    } catch {
        Write-Warn "PUT /v1/nfe-config falhou (pode já existir): $_"
    }

    # ── 3. Criar cliente destinatário ─────────────────────────────────────────
    Write-Step "3/6 — Criando cliente destinatário de teste..."
    try {
        $client = api-post '/v1/clients' @{
            person_type   = "PJ"
            company_name  = "EMPRESA DESTINO TESTE LTDA"
            cnpj          = "07504505000132"
            email         = "destino@teste.com"
            zip_code      = "01310100"
            street        = "Av. Paulista"
            street_number = "1000"
            neighborhood  = "Bela Vista"
            city          = "Sao Paulo"
            state         = "SP"
            icms_taxpayer = "9"
            consumer_type = "1"
        } -token $jwt
        $clientId = $client.id
        Write-OK "Cliente criado: id=$clientId"
    } catch {
        Write-Fail "Falha ao criar cliente: $_"
        exit 1
    }

    # ── 4. Criar invoice em rascunho ──────────────────────────────────────────
    Write-Step "4/6 — Criando NF-e em rascunho..."
    try {
        $invoice = api-post '/v1/invoices' @{
            client_id    = $clientId
            serie        = "1"
            tax_regime   = "lucro_presumido"
            origin_state = "SP"
            notes        = "NF-e de teste via script test-nfe-aws.ps1"
            items        = @(
                @{
                    name          = "Produto Teste Homologacao"
                    ncm_code      = "7318.15.00"
                    cfop          = "5102"
                    quantity      = 1
                    unit_price    = 100.00
                    icms_cst      = "00"
                    icms_base     = 100.00
                    icms_rate     = 12
                    icms_value    = 12.00
                    pis_cst       = "01"
                    pis_base      = 100.00
                    pis_rate      = 0.65
                    pis_value     = 0.65
                    cofins_cst    = "01"
                    cofins_base   = 100.00
                    cofins_rate   = 3.00
                    cofins_value  = 3.00
                    ipi_rate      = 0
                    ipi_value     = 0
                }
            )
        } -token $jwt
        $invoiceId = $invoice.id
        Write-OK "Invoice criada: id=$invoiceId | status=$($invoice.status ?? 'draft')"
    } catch {
        Write-Fail "Falha ao criar invoice: $_"
        exit 1
    }

    # ── 5. Emitir ─────────────────────────────────────────────────────────────
    Write-Step "5/6 — Disparando emissão (POST /v1/invoices/$invoiceId/emit)..."
    try {
        $emitResult = api-post "/v1/invoices/$invoiceId/emit" @{} -token $jwt
        Write-OK "Emissão enfileirada | nfe_status=$($emitResult.nfe_status)"
        Write-Host "   (fluxo: API → SQS nfe-requests → Lambda → Focus NF-e → SEFAZ → SQS nfe-results)" -ForegroundColor DarkGray
    } catch {
        Write-Fail "Falha ao emitir: $_"
        exit 1
    }

    # ── 6. Polling do status ───────────────────────────────────────────────────
    Write-Step "6/6 — Aguardando resultado (polling por até 120s)..."
    $deadline = (Get-Date).AddSeconds(120)
    $lastStatus = ''

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        try {
            $nfe = api-get "/v1/invoices/$invoiceId/nfe" -token $jwt
            $st  = $nfe.nfe_status

            if ($st -ne $lastStatus) {
                Write-Host "   → nfe_status = $st" -ForegroundColor $(
                    switch ($st) {
                        'authorized' { 'Green' }
                        'rejected'   { 'Red'   }
                        'error'      { 'Red'   }
                        default      { 'Yellow' }
                    })
                $lastStatus = $st
            }

            if ($st -in @('authorized', 'rejected', 'error')) {
                Write-Host ""
                if ($st -eq 'authorized') {
                    Write-OK "NF-e AUTORIZADA com sucesso!"
                    Write-Host "   Chave    : $($nfe.nfe_chave)" -ForegroundColor Green
                    Write-Host "   Protocolo: $($nfe.nfe_protocol)" -ForegroundColor Green
                    Write-Host "   Auth date: $($nfe.nfe_auth_date)" -ForegroundColor Green
                    if ($nfe.nfe_danfe_url) {
                        Write-Host "   DANFE URL: $($nfe.nfe_danfe_url)" -ForegroundColor Cyan
                    }
                } else {
                    Write-Fail "NF-e $($st.ToUpper())"
                    if ($nfe.nfe_reject_reason) {
                        Write-Host "   Motivo: $($nfe.nfe_reject_reason)" -ForegroundColor Red
                    }
                }
                break
            }
        } catch {
            Write-Warn "Erro no poll: $_"
        }

        $remaining = [int](($deadline - (Get-Date)).TotalSeconds)
        Write-Host "   Aguardando... ($remaining s | status atual: $lastStatus)" -ForegroundColor DarkGray
    }

    if ($lastStatus -notin @('authorized', 'rejected', 'error')) {
        Write-Fail "Timeout 120s — status ainda '$lastStatus'. Verifique os logs do Lambda:"
        Write-Host "   aws logs tail $LogGroupLambda --follow --region $Region" -ForegroundColor Cyan
    }

    Write-Step "Logs recentes do Lambda (últimas 20 linhas)..."
    Show-LambdaLogs -Lines 20
}

# ── Shared: tail CloudWatch logs ──────────────────────────────────────────────

function Show-LambdaLogs([int]$Lines = 20) {
    try {
        $streams = Invoke-Aws @('logs', 'describe-log-streams',
            '--log-group-name', $LogGroupLambda,
            '--order-by', 'LastEventTime',
            '--descending',
            '--max-items', '2')

        if (-not $streams.logStreams) {
            Write-Warn "Nenhum log stream encontrado para $LogGroupLambda"
            return
        }

        $stream = $streams.logStreams[0]
        $events = Invoke-Aws @('logs', 'get-log-events',
            '--log-group-name', $LogGroupLambda,
            '--log-stream-name', $stream.logStreamName,
            '--limit', [string]$Lines,
            '--start-from-head', 'false')

        Write-Host "   [Stream: $($stream.logStreamName)]" -ForegroundColor DarkGray
        foreach ($ev in $events.events) {
            $ts   = [DateTimeOffset]::FromUnixTimeMilliseconds($ev.timestamp).LocalDateTime.ToString('HH:mm:ss')
            $line = $ev.message.Trim()
            $color = if ($line -match 'nfe_authorized|autorizado')      { 'Green'  }
                     elseif ($line -match 'ERROR|error|WARN|rejected')   { 'Red'    }
                     elseif ($line -match 'nfe_start|nfe_submitted')     { 'Yellow' }
                     else                                                  { 'Gray'   }
            Write-Host "   $ts  $line" -ForegroundColor $color
        }
    } catch {
        Write-Warn "Logs indisponíveis: $_ "
        Write-Host "   Execute manualmente:" -ForegroundColor DarkGray
        Write-Host "   aws logs tail $LogGroupLambda --follow --region $Region" -ForegroundColor Cyan
    }
}

# ── Sumário de recursos ───────────────────────────────────────────────────────

Write-Host "`n   Recursos AWS alvo:" -ForegroundColor DarkGray
Write-Host "   Lambda   : $LambdaName" -ForegroundColor DarkGray
Write-Host "   SQS req  : $QueueReq"  -ForegroundColor DarkGray
Write-Host "   SQS res  : $QueueRes"  -ForegroundColor DarkGray
Write-Host "   SQS dlq  : $QueueDlq"  -ForegroundColor DarkGray
Write-Host "   S3 bucket: $S3Bucket"  -ForegroundColor DarkGray
Write-Host "   CW logs  : $LogGroupLambda" -ForegroundColor DarkGray

# ── Dispatch ─────────────────────────────────────────────────────────────────

switch ($Mode) {
    'monitor'    { Invoke-Monitor   }
    'direct-sqs' { Invoke-DirectSqs }
    'api'        { Invoke-ApiTest   }
}

Write-Host "`n$('─' * 60)" -ForegroundColor DarkGray
Write-Host "  Concluído. Use -Mode monitor para re-checar o estado." -ForegroundColor DarkGray
Write-Host "$('─' * 60)`n" -ForegroundColor DarkGray

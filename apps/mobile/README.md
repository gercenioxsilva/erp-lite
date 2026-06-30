# Orquestra ERP — App Mobile (Flutter)

App mobile (Android & iOS) do **Orquestra ERP**. Consome a **mesma API REST `/v1/*`**
do backoffice web (nenhuma rota exclusiva do mobile — ver Regra 2 do README raiz).

## Stack

| Camada | Pacote |
|--------|--------|
| State management | `flutter_riverpod` (Notifier/AsyncNotifier — sem codegen) |
| HTTP | `dio` (Bearer JWT + injeção de `tenant_id` na query) |
| Navegação | `go_router` (redirect de auth) |
| Sessão segura | `flutter_secure_storage` (Keychain/EncryptedSharedPreferences) |
| Formatação pt-BR | `intl` (R$ + dd/MM/yyyy) |
| Scanner | `mobile_scanner` (código de barras em Materiais) |
| Links externos | `url_launcher` (DANFE/boleto no browser) |

> Push/FCM não incluído nesta versão (sem dependência de Firebase).

## Estrutura

```
lib/
├── main.dart · router.dart
├── core/
│   ├── api/      (api_client, endpoints, api_exception, pagination, paged_list)
│   ├── auth/     (auth_repository, auth_provider, secure_storage)
│   ├── theme/    (app_theme, app_colors — paleta Orquestra #3B5CE4/#00B4D8)
│   ├── i18n/     (strings_pt_br)
│   ├── widgets/  (app_scaffold, status_badge, paged_list_body, payment_sheet, …)
│   └── utils/    (currency_formatter, date_formatter)
└── features/     (auth, dashboard, clients, materials, stock, suppliers,
                   orders, invoices, receivables, payables, cost_centers, proposals)
```

## Rodando

```bash
flutter pub get

# Android emulador (API aponta para o host via 10.0.2.2)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000

# iOS simulator (API local)
flutter run --dart-define=API_BASE_URL=http://localhost:3004

# Análise estática e testes
flutter analyze
flutter test
```

### Rodando em device físico (Android/iOS)

No celular, `localhost`/`10.0.2.2` apontam para o próprio aparelho — é preciso
usar o **IP da máquina que roda a API** na rede Wi-Fi (ex.: `10.0.0.157`).
Descubra o IP com `ipconfig getifaddr en0` (macOS).

**Pré-requisitos**

1. **API acessível na LAN:** a `api-core` já binda em `0.0.0.0:3000` (host na
   `.env`). Suba o backend e confirme com `curl http://<IP>:3000/...`.
2. **Mesma rede Wi-Fi:** celular e máquina no mesmo Wi-Fi.
3. **HTTP cleartext liberado (DEV-only):** o app usa HTTP em dev, bloqueado por
   padrão nas duas plataformas. Já está habilitado neste repo:
   - Android: `android:usesCleartextTraffic="true"` em
     `android/app/src/main/AndroidManifest.xml`.
   - iOS: `NSAppTransportSecurity → NSAllowsArbitraryLoads` em
     `ios/Runner/Info.plist`.

   > ⚠️ Ambos são **somente para desenvolvimento**. Em produção a API é HTTPS
   > (`https://orquestraerp.com.br`) — remova/restrinja essas flags antes de
   > publicar.

**Conectar o device**

- **Android:** ativar *Opções do desenvolvedor* → *Depuração USB*, conectar via
  cabo e autorizar o popup.
- **iOS:** abrir `ios/Runner.xcworkspace` no Xcode uma vez para configurar
  *Signing & Team*, e *Confiar* no perfil no iPhone
  (Ajustes → Geral → VPN e Gerenciamento de dispositivos).

Confirme o device em `flutter devices`, depois rode apontando para o IP da máquina:

```bash
# Substitua 10.0.0.157 pelo IP da SUA máquina na rede
flutter run --dart-define=API_BASE_URL=http://10.0.0.157:3000

# APK de teste (debug)
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.0.157:3000
```

**Troubleshooting**

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| timeout / connection refused | URL default (`10.0.2.2`) | passar `--dart-define=API_BASE_URL=http://<IP>:3000` |
| conexão falha sem erro claro | cleartext bloqueado | conferir flags do passo 3 |
| timeout | redes Wi-Fi diferentes | celular e máquina no mesmo Wi-Fi |
| timeout só no device | firewall do macOS | liberar conexões de entrada para o `node` |

### Smoke test de login real (backend local)

```bash
# Suba o backend (na raiz do monorepo):
docker compose up -d db localstack api-core
docker compose --profile migrate up migrate

# Rode o teste contra a API local (porta efetiva: docker compose port api-core 3000):
flutter test test/live_login_smoke_test.dart \
  --dart-define=API_BASE_URL=http://localhost:3004 \
  --dart-define=SMOKE_EMAIL=teste@orquestra.com \
  --dart-define=SMOKE_PASSWORD=senha1234
```

O teste pula automaticamente se a API local não estiver no ar.

## Convenções (do README raiz)

- `tenant_id` nunca é digitado: vem do JWT/sessão; o `ApiClient` o injeta na query
  para as rotas legadas e envia `Authorization: Bearer` para as rotas JWT.
- Soft-delete: `PATCH is_active:false` / status — nunca DELETE físico.
- Paginação `page`+`per_page` (≤100, default 20) com scroll infinito.
- Estados `loading`/`error`/`empty`/`data` via `AsyncValue`.
- Status machines idênticas ao web (orders/invoices/proposals).

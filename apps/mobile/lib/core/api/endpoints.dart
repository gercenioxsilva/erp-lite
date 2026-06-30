/// Base URL da API e constantes de rotas /v1/*.
///
/// Configurar via --dart-define na build:
///   flutter run --dart-define=API_BASE_URL=http://localhost:3004
///
/// Defaults (README):
///   Android emulador: http://10.0.2.2:3000
///   iOS simulator:    http://localhost:3000
///   Produção:         https://orquestraerp.com.br
const String kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);

/// Constantes de caminhos. Todas autenticadas exceto auth/* e public/*.
abstract final class Endpoints {
  const Endpoints._();

  // Auth
  static const String login = '/v1/auth/login';
  static const String register = '/v1/auth/register';
  static const String me = '/v1/auth/me';
  static const String forgotPassword = '/v1/auth/forgot-password';
  static const String resetPassword = '/v1/auth/reset-password';

  // Dashboard
  static const String dashboard = '/v1/dashboard';
  static const String cashflow = '/v1/dashboard/cashflow';

  // Listagens / CRUD
  static const String clients = '/v1/clients';
  static const String materials = '/v1/materials';
  static const String stock = '/v1/stock';
  static const String stockMovements = '/v1/stock/movements';
  static const String stockAlerts = '/v1/stock/alerts';
  static const String orders = '/v1/orders';
  static const String invoices = '/v1/invoices';
  static const String nfse = '/v1/nfse';
  static const String receivables = '/v1/receivables';
  static const String payables = '/v1/payables';
  static const String suppliers = '/v1/suppliers';
  static const String costCenters = '/v1/cost-centers';
  static const String proposals = '/v1/proposals';
  static const String serviceContracts = '/v1/service-contracts';
  static const String users = '/v1/users';
  static const String tenant = '/v1/tenant';
}

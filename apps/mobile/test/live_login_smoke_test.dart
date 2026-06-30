// Smoke test de LOGIN REAL contra a API local (docker compose).
//
// Roda na VM do Dart (sem device) com um SecureStorage em memória, exercitando
// o ApiClient + AuthRepository reais. Pula automaticamente se a API local não
// estiver no ar.
//
// Uso:
//   flutter test test/live_login_smoke_test.dart \
//     --dart-define=API_BASE_URL=http://localhost:3001 \
//     --dart-define=SMOKE_EMAIL=teste@orquestra.com \
//     --dart-define=SMOKE_PASSWORD=senha1234
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orquestra_mobile/core/api/api_client.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/auth/auth_repository.dart';
import 'package:orquestra_mobile/core/auth/secure_storage.dart';

const _email = String.fromEnvironment('SMOKE_EMAIL',
    defaultValue: 'teste@orquestra.com');
const _password =
    String.fromEnvironment('SMOKE_PASSWORD', defaultValue: 'senha1234');

/// SecureStorage em memória (sem platform channels) para rodar na VM.
class _MemStorage implements SecureStorageLike {
  String? token;
  String? tenantId;
  @override
  Future<String?> readToken() async => token;
  @override
  Future<String?> readTenantId() async => tenantId;
  @override
  Future<void> saveSession(
      {required String token, required String tenantId}) async {
    this.token = token;
    this.tenantId = tenantId;
  }

  @override
  Future<void> clear() async {
    token = null;
    tenantId = null;
  }
}

Future<bool> _apiUp() async {
  try {
    final uri = Uri.parse('$kApiBaseUrl/health');
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 2);
    final req = await client.getUrl(uri);
    final res = await req.close();
    client.close();
    return res.statusCode < 500;
  } on Object {
    return false;
  }
}

void main() {
  test('login real + dashboard contra API local', () async {
    if (!await _apiUp()) {
      markTestSkipped('API local indisponível em $kApiBaseUrl — pulando');
      return;
    }

    final storage = _MemStorage();
    final api = ApiClient(storage);
    final repo = AuthRepository(api);

    // Login real
    final user = await repo.login(_email, _password);
    expect(user.tenantId, isNotEmpty);
    expect(api.isAuthenticated, isTrue);
    expect(storage.token, isNotNull);

    // /auth/me reidrata
    final me = await repo.currentUser();
    expect(me, isNotNull);
    expect(me!.email.toLowerCase(), _email.toLowerCase());

    // Dashboard (rota JWT) responde
    final dash = await api.get(Endpoints.dashboard) as Map<String, dynamic>;
    expect(dash.containsKey('receivables'), isTrue);
    expect(dash.containsKey('revenue'), isTrue);
  });
}

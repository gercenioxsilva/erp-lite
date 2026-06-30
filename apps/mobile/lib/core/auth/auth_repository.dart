import 'package:orquestra_mobile/core/api/api_client.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';

/// Usuário autenticado (espelha o retorno de /auth/login e /auth/me).
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.tenantId,
  });

  final String id;
  final String email;
  final String name;
  final String role;
  final String tenantId;

  /// /auth/login → { token, user:{id,email,name,role}, tenantId }
  factory AuthUser.fromLogin(Map<String, dynamic> json) {
    final user = (json['user'] as Map<String, dynamic>? ?? <String, dynamic>{});
    return AuthUser(
      id: user['id']?.toString() ?? '',
      email: user['email']?.toString() ?? '',
      name: user['name']?.toString() ?? '',
      role: user['role']?.toString() ?? '',
      tenantId: json['tenantId']?.toString() ?? '',
    );
  }

  /// /auth/me → { id, email, name, role, tenant_id, status }
  factory AuthUser.fromMe(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      role: json['role']?.toString() ?? '',
      tenantId: json['tenant_id']?.toString() ?? '',
    );
  }
}

/// Operações de autenticação contra /v1/auth/*.
class AuthRepository {
  const AuthRepository(this._api);

  final ApiClient _api;

  Future<AuthUser> login(String email, String password) async {
    final data = await _api.post(
      Endpoints.login,
      body: <String, dynamic>{'email': email, 'password': password},
    ) as Map<String, dynamic>;
    final token = data['token']?.toString() ?? '';
    final user = AuthUser.fromLogin(data);
    await _api.setSession(token: token, tenantId: user.tenantId);
    return user;
  }

  /// Reidrata a sessão persistida chamando /auth/me. Retorna null se não há
  /// token válido.
  Future<AuthUser?> currentUser() async {
    if (!_api.isAuthenticated) return null;
    final data = await _api.get(Endpoints.me) as Map<String, dynamic>?;
    if (data == null) return null;
    return AuthUser.fromMe(data);
  }

  Future<void> forgotPassword(String email) async {
    await _api.post(
      Endpoints.forgotPassword,
      body: <String, dynamic>{'email': email},
    );
  }

  Future<void> logout() => _api.clearSession();
}

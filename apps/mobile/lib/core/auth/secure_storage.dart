import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Contrato de armazenamento de sessão — permite injetar um fake em testes.
abstract interface class SecureStorageLike {
  Future<String?> readToken();
  Future<String?> readTenantId();
  Future<void> saveSession({required String token, required String tenantId});
  Future<void> clear();
}

/// Implementação real sobre flutter_secure_storage (Keychain iOS /
/// EncryptedSharedPreferences Android).
class SecureStorage implements SecureStorageLike {
  SecureStorage([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const String _kToken = 'auth_token';
  static const String _kTenantId = 'tenant_id';

  @override
  Future<String?> readToken() => _storage.read(key: _kToken);
  @override
  Future<String?> readTenantId() => _storage.read(key: _kTenantId);

  @override
  Future<void> saveSession({
    required String token,
    required String tenantId,
  }) async {
    await _storage.write(key: _kToken, value: token);
    await _storage.write(key: _kTenantId, value: tenantId);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kTenantId);
  }
}

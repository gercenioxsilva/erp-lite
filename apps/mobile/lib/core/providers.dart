import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_client.dart';
import 'package:orquestra_mobile/core/auth/auth_repository.dart';
import 'package:orquestra_mobile/core/auth/secure_storage.dart';

/// Providers de infraestrutura compartilhados por todo o app.
final secureStorageProvider = Provider<SecureStorage>(
  (ref) => SecureStorage(),
);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(secureStorageProvider));
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider));
});

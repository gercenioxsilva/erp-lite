import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/auth/auth_repository.dart';
import 'package:orquestra_mobile/core/providers.dart';

/// Estado de autenticação do app. `null` = deslogado; AuthUser = logado.
/// `loading` durante bootstrap/login; `error` em falha de login.
class AuthNotifier extends AsyncNotifier<AuthUser?> {
  @override
  Future<AuthUser?> build() async {
    final api = ref.watch(apiClientProvider);
    await api.bootstrap();
    // 401 em qualquer ponto invalida a sessão (Regra Mobile-8).
    api.onUnauthorized = _onUnauthorized;
    final repo = ref.watch(authRepositoryProvider);
    try {
      return await repo.currentUser();
    } on Object {
      // Token persistido inválido/expirado → trata como deslogado.
      await repo.logout();
      return null;
    }
  }

  Future<void> login(String email, String password) async {
    final repo = ref.read(authRepositoryProvider);
    state = const AsyncValue<AuthUser?>.loading();
    state = await AsyncValue.guard(() => repo.login(email, password));
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = const AsyncValue<AuthUser?>.data(null);
  }

  void _onUnauthorized() {
    state = const AsyncValue<AuthUser?>.data(null);
  }
}

final authNotifierProvider =
    AsyncNotifierProvider<AuthNotifier, AuthUser?>(AuthNotifier.new);

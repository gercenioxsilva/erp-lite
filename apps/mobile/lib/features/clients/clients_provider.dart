import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';

class ClientsNotifier extends PagedListNotifier<Client> {
  @override
  Future<PagedResult<Client>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.clients, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Client.fromJson);
  }

  /// POST /v1/clients — o backend exige tenant_id no body (exceção da Regra 4).
  Future<Client> create(Map<String, dynamic> body) async {
    final api = ref.read(apiClientProvider);
    final payload = <String, dynamic>{
      'tenant_id': api.tenantId,
      ...body,
    };
    final data = await api.post(Endpoints.clients, body: payload)
        as Map<String, dynamic>;
    await refresh();
    return Client.fromJson(data);
  }

  Future<Client> update(String id, Map<String, dynamic> body) async {
    final api = ref.read(apiClientProvider);
    final data = await api.patch('${Endpoints.clients}/$id', body: body)
        as Map<String, dynamic>;
    await refresh();
    return Client.fromJson(data);
  }

  /// Soft-delete (Regra Mobile-6): PATCH is_active:false.
  Future<void> deactivate(String id) async {
    await ref
        .read(apiClientProvider)
        .patch('${Endpoints.clients}/$id', body: {'is_active': false});
    await refresh();
  }
}

final clientsProvider =
    AutoDisposeNotifierProvider<ClientsNotifier, PagedListState<Client>>(
  ClientsNotifier.new,
);

final clientDetailProvider =
    FutureProvider.autoDispose.family<Client, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data = await api.get('${Endpoints.clients}/$id') as Map<String, dynamic>;
  return Client.fromJson(data);
});

final clientHistoryProvider =
    FutureProvider.autoDispose.family<ClientHistory, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.clients}/$id/history') as Map<String, dynamic>;
  return ClientHistory.fromJson(data);
});

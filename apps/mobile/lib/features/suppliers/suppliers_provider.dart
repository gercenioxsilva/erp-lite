import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_model.dart';

class SuppliersNotifier extends PagedListNotifier<Supplier> {
  @override
  Future<PagedResult<Supplier>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.suppliers, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Supplier.fromJson);
  }
}

final suppliersProvider =
    AutoDisposeNotifierProvider<SuppliersNotifier, PagedListState<Supplier>>(
  SuppliersNotifier.new,
);

final supplierDetailProvider =
    FutureProvider.autoDispose.family<Supplier, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.suppliers}/$id') as Map<String, dynamic>;
  return Supplier.fromJson(data);
});

/// Contas a pagar vinculadas ao fornecedor (GET /v1/suppliers/:id/payables).
final supplierPayablesProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('${Endpoints.suppliers}/$id/payables');
  final list = res is Map<String, dynamic>
      ? (res['data'] as List<dynamic>? ?? const [])
      : (res as List<dynamic>? ?? const []);
  return list.map((e) => e as Map<String, dynamic>).toList(growable: false);
});

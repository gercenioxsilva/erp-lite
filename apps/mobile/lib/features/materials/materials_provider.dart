import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';

class MaterialsNotifier extends PagedListNotifier<MaterialItem> {
  @override
  Future<PagedResult<MaterialItem>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.materials, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, MaterialItem.fromJson);
  }
}

final materialsProvider =
    AutoDisposeNotifierProvider<MaterialsNotifier, PagedListState<MaterialItem>>(
  MaterialsNotifier.new,
);

final materialDetailProvider =
    FutureProvider.autoDispose.family<MaterialItem, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.materials}/$id') as Map<String, dynamic>;
  return MaterialItem.fromJson(data);
});

/// Saldo de estoque do material (pode não existir se não rastreia estoque).
final materialStockProvider =
    FutureProvider.autoDispose.family<MaterialStock?, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  try {
    final data = await api.get('${Endpoints.materials}/$id/stock')
        as Map<String, dynamic>;
    return MaterialStock.fromJson(data);
  } on RequestException {
    return null; // 404 — material não rastreia estoque
  }
});

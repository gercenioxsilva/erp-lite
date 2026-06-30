import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_model.dart';

class CostCentersNotifier extends PagedListNotifier<CostCenter> {
  @override
  Future<PagedResult<CostCenter>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.costCenters, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, CostCenter.fromJson);
  }
}

final costCentersProvider = AutoDisposeNotifierProvider<CostCentersNotifier,
    PagedListState<CostCenter>>(CostCentersNotifier.new);

final costCenterDetailProvider =
    FutureProvider.autoDispose.family<CostCenter, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.costCenters}/$id') as Map<String, dynamic>;
  return CostCenter.fromJson(data);
});

/// Saldo por material (GET /:id/stock retorna um array).
final costCenterStockProvider = FutureProvider.autoDispose
    .family<List<CostCenterStock>, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('${Endpoints.costCenters}/$id/stock');
  final list = res as List<dynamic>? ?? const [];
  return list
      .map((e) => CostCenterStock.fromJson(e as Map<String, dynamic>))
      .toList(growable: false);
});

/// Movimentações (primeira página).
final costCenterMovementsProvider = FutureProvider.autoDispose
    .family<List<CostCenterMovement>, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data = await api.get('${Endpoints.costCenters}/$id/movements',
      query: {'per_page': 100}) as Map<String, dynamic>;
  final list = data['data'] as List<dynamic>? ?? const [];
  return list
      .map((e) => CostCenterMovement.fromJson(e as Map<String, dynamic>))
      .toList(growable: false);
});

class CostCenterActions {
  const CostCenterActions(this.ref);
  final Ref ref;

  /// POST /:id/entries — entrada manual de material.
  Future<void> addEntry(
    String id, {
    required String materialId,
    required num quantity,
    required num unitCost,
    String? note,
  }) async {
    await ref.read(apiClientProvider).post(
      '${Endpoints.costCenters}/$id/entries',
      body: {
        'material_id': materialId,
        'quantity': quantity,
        'unit_cost': unitCost,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    ref.invalidate(costCenterStockProvider(id));
    ref.invalidate(costCenterMovementsProvider(id));
  }
}

final costCenterActionsProvider =
    Provider<CostCenterActions>((ref) => CostCenterActions(ref));

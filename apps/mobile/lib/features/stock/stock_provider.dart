import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/stock/stock_model.dart';

class StockNotifier extends PagedListNotifier<StockItem> {
  @override
  Future<PagedResult<StockItem>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.stock, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, StockItem.fromJson);
  }
}

final stockProvider =
    AutoDisposeNotifierProvider<StockNotifier, PagedListState<StockItem>>(
  StockNotifier.new,
);

/// Alertas de estoque mínimo (GET /v1/stock/alerts).
final stockAlertsProvider =
    FutureProvider.autoDispose<List<StockItem>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final data = await api.get(Endpoints.stockAlerts) as Map<String, dynamic>;
  final list = data['data'] as List<dynamic>? ?? const [];
  return list
      .map((e) => StockItem.fromJson(e as Map<String, dynamic>))
      .toList(growable: false);
});

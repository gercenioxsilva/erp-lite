import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';

class OrdersNotifier extends PagedListNotifier<Order> {
  @override
  Future<PagedResult<Order>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.orders, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Order.fromJson);
  }

  /// POST /v1/orders — tenant_id no body (exceção da Regra 4).
  Future<Order> create({
    required String clientId,
    required List<DraftItem> items,
    String? notes,
    num discount = 0,
    num shipping = 0,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.post(Endpoints.orders, body: {
      'tenant_id': api.tenantId,
      'client_id': clientId,
      'items': items.map((i) => i.toJson()).toList(),
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      'discount': discount,
      'shipping': shipping,
    }) as Map<String, dynamic>;
    await refresh();
    return Order.fromJson(data);
  }
}

final ordersProvider =
    AutoDisposeNotifierProvider<OrdersNotifier, PagedListState<Order>>(
  OrdersNotifier.new,
);

final orderDetailProvider =
    FutureProvider.autoDispose.family<Order, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data = await api.get('${Endpoints.orders}/$id') as Map<String, dynamic>;
  return Order.fromJson(data);
});

/// Transições de estado do pedido (confirm/deliver/cancel).
class OrderActions {
  const OrderActions(this.ref);
  final Ref ref;

  Future<void> _action(String id, String action) async {
    await ref.read(apiClientProvider).post('${Endpoints.orders}/$id/$action');
    ref.invalidate(orderDetailProvider(id));
    ref.invalidate(ordersProvider);
  }

  Future<void> confirm(String id) => _action(id, 'confirm');
  Future<void> deliver(String id) => _action(id, 'deliver');
  Future<void> cancel(String id) => _action(id, 'cancel');
}

final orderActionsProvider = Provider<OrderActions>((ref) => OrderActions(ref));

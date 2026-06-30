import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/payables/payables_model.dart';

class PayablesNotifier extends PagedListNotifier<Payable> {
  @override
  Future<PagedResult<Payable>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.payables, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Payable.fromJson);
  }
}

final payablesProvider =
    AutoDisposeNotifierProvider<PayablesNotifier, PagedListState<Payable>>(
  PayablesNotifier.new,
);

final payableDetailProvider =
    FutureProvider.autoDispose.family<Payable, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.payables}/$id') as Map<String, dynamic>;
  return Payable.fromJson(data);
});

class PayableActions {
  const PayableActions(this.ref);
  final Ref ref;

  Future<void> registerPayment(String id, Map<String, dynamic> body) async {
    await ref
        .read(apiClientProvider)
        .post('${Endpoints.payables}/$id/payments', body: body);
    ref.invalidate(payableDetailProvider(id));
    ref.invalidate(payablesProvider);
  }
}

final payableActionsProvider =
    Provider<PayableActions>((ref) => PayableActions(ref));

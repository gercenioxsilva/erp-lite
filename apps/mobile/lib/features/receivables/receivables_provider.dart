import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/receivables/receivables_model.dart';

class ReceivablesNotifier extends PagedListNotifier<Receivable> {
  @override
  Future<PagedResult<Receivable>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.receivables, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Receivable.fromJson);
  }
}

final receivablesProvider = AutoDisposeNotifierProvider<ReceivablesNotifier,
    PagedListState<Receivable>>(ReceivablesNotifier.new);

final receivableDetailProvider =
    FutureProvider.autoDispose.family<Receivable, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.receivables}/$id') as Map<String, dynamic>;
  return Receivable.fromJson(data);
});

class ReceivableActions {
  const ReceivableActions(this.ref);
  final Ref ref;

  Future<void> _refresh(String id) async {
    ref.invalidate(receivableDetailProvider(id));
    ref.invalidate(receivablesProvider);
  }

  Future<void> registerPayment(String id, Map<String, dynamic> body) async {
    await ref
        .read(apiClientProvider)
        .post('${Endpoints.receivables}/$id/payments', body: body);
    await _refresh(id);
  }

  Future<void> emitBoleto(String id) async {
    await ref
        .read(apiClientProvider)
        .post('${Endpoints.receivables}/$id/emit-boleto');
    await _refresh(id);
  }
}

final receivableActionsProvider =
    Provider<ReceivableActions>((ref) => ReceivableActions(ref));

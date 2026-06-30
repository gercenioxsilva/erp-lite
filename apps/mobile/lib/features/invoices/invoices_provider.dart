import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/invoices/invoices_model.dart';

class InvoicesNotifier extends PagedListNotifier<Invoice> {
  @override
  Future<PagedResult<Invoice>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.invoices, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Invoice.fromJson);
  }
}

final invoicesProvider =
    AutoDisposeNotifierProvider<InvoicesNotifier, PagedListState<Invoice>>(
  InvoicesNotifier.new,
);

final invoiceDetailProvider =
    FutureProvider.autoDispose.family<Invoice, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.invoices}/$id') as Map<String, dynamic>;
  return Invoice.fromJson(data);
});

class InvoiceActions {
  const InvoiceActions(this.ref);
  final Ref ref;

  Future<void> _refresh(String id) async {
    ref.invalidate(invoiceDetailProvider(id));
    ref.invalidate(invoicesProvider);
  }

  Future<void> emit(String id) async {
    await ref.read(apiClientProvider).post('${Endpoints.invoices}/$id/emit');
    await _refresh(id);
  }

  Future<void> cancel(String id) async {
    await ref.read(apiClientProvider).post('${Endpoints.invoices}/$id/cancel');
    await _refresh(id);
  }
}

final invoiceActionsProvider =
    Provider<InvoiceActions>((ref) => InvoiceActions(ref));

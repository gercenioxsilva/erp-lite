import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';
import 'package:orquestra_mobile/features/proposals/proposals_model.dart';

class ProposalsNotifier extends PagedListNotifier<Proposal> {
  @override
  Future<PagedResult<Proposal>> fetchPage({
    required int page,
    required String search,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.get(Endpoints.proposals, query: {
      'page': page,
      'per_page': PagedListNotifier.perPage,
      if (search.isNotEmpty) 'search': search,
    }) as Map<String, dynamic>;
    return PagedResult.fromJson(data, Proposal.fromJson);
  }

  /// POST /v1/proposals.
  Future<Proposal> create({
    required String clientId,
    required String title,
    required String validUntil,
    required List<DraftItem> items,
    String? notes,
  }) async {
    final api = ref.read(apiClientProvider);
    final data = await api.post(Endpoints.proposals, body: {
      'client_id': clientId,
      'title': title,
      'valid_until': validUntil,
      'items': items.map((i) => i.toJson()).toList(),
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    }) as Map<String, dynamic>;
    await refresh();
    return Proposal.fromJson(data);
  }
}

final proposalsProvider =
    AutoDisposeNotifierProvider<ProposalsNotifier, PagedListState<Proposal>>(
  ProposalsNotifier.new,
);

final proposalDetailProvider =
    FutureProvider.autoDispose.family<Proposal, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final data =
      await api.get('${Endpoints.proposals}/$id') as Map<String, dynamic>;
  return Proposal.fromJson(data);
});

class ProposalActions {
  const ProposalActions(this.ref);
  final Ref ref;

  Future<void> _refresh(String id) async {
    ref.invalidate(proposalDetailProvider(id));
    ref.invalidate(proposalsProvider);
  }

  Future<void> send(String id) async {
    await ref.read(apiClientProvider).post('${Endpoints.proposals}/$id/send');
    await _refresh(id);
  }

  Future<void> convert(String id) async {
    await ref
        .read(apiClientProvider)
        .post('${Endpoints.proposals}/$id/convert');
    await _refresh(id);
  }

  Future<void> cancel(String id) async {
    await ref
        .read(apiClientProvider)
        .post('${Endpoints.proposals}/$id/cancel');
    await _refresh(id);
  }
}

final proposalActionsProvider =
    Provider<ProposalActions>((ref) => ProposalActions(ref));

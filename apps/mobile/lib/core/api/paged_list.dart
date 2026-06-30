import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/api/pagination.dart';

enum PagedStatus { loading, ready, error }

/// Estado de uma lista paginada com busca + scroll infinito.
class PagedListState<T> {
  const PagedListState({
    this.items = const [],
    this.status = PagedStatus.loading,
    this.hasMore = false,
    this.page = 1,
    this.search = '',
    this.error,
  });

  final List<T> items;
  final PagedStatus status;
  final bool hasMore;
  final int page;
  final String search;
  final String? error;

  PagedListState<T> copyWith({
    List<T>? items,
    PagedStatus? status,
    bool? hasMore,
    int? page,
    String? search,
    String? error,
  }) {
    return PagedListState<T>(
      items: items ?? this.items,
      status: status ?? this.status,
      hasMore: hasMore ?? this.hasMore,
      page: page ?? this.page,
      search: search ?? this.search,
      error: error,
    );
  }
}

/// Base para notifiers de listagem. Subclasses implementam [fetchPage].
abstract class PagedListNotifier<T>
    extends AutoDisposeNotifier<PagedListState<T>> {
  static const int perPage = 20;

  /// Busca uma página da API.
  Future<PagedResult<T>> fetchPage({
    required int page,
    required String search,
  });

  @override
  PagedListState<T> build() {
    Future.microtask(load);
    return PagedListState<T>(status: PagedStatus.loading);
  }

  Future<void> load() async {
    state = state.copyWith(status: PagedStatus.loading, error: null);
    await _fetchInto(page: 1, append: false);
  }

  Future<void> refresh() => _fetchInto(page: 1, append: false);

  Future<void> loadMore() async {
    if (!state.hasMore) return;
    await _fetchInto(page: state.page + 1, append: true);
  }

  Future<void> setSearch(String term) async {
    state = state.copyWith(search: term, status: PagedStatus.loading);
    await _fetchInto(page: 1, append: false);
  }

  Future<void> _fetchInto({required int page, required bool append}) async {
    try {
      final result = await fetchPage(page: page, search: state.search);
      final merged = append
          ? <T>[...state.items, ...result.items]
          : result.items;
      state = state.copyWith(
        items: merged,
        status: PagedStatus.ready,
        hasMore: result.hasMore,
        page: result.page,
        error: null,
      );
    } on ApiException catch (e) {
      state = state.copyWith(status: PagedStatus.error, error: e.message);
    }
  }
}

/// Envelope de paginação das rotas de listagem. O backend usa DOIS formatos:
///   A) `{ data: [...], total, page, per_page }`         (clients, stock, suppliers…)
///   B) `{ data: [...], meta: { total, page, per_page } }` (materials…)
/// Este parser aceita ambos.
class PagedResult<T> {
  const PagedResult({
    required this.items,
    required this.total,
    required this.page,
    required this.perPage,
  });

  final List<T> items;
  final int total;
  final int page;
  final int perPage;

  bool get hasMore => page * perPage < total;
  int get nextPage => page + 1;

  static PagedResult<T> fromJson<T>(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromItem,
  ) {
    final rawList = (json['data'] as List<dynamic>? ?? <dynamic>[]);
    final meta = json['meta'] as Map<String, dynamic>?;
    int read(String key, int fallback) =>
        _int(json[key] ?? meta?[key], fallback: fallback);

    return PagedResult<T>(
      items: rawList
          .map((e) => fromItem(e as Map<String, dynamic>))
          .toList(growable: false),
      total: read('total', 0),
      page: read('page', 1),
      perPage: read('per_page', 20),
    );
  }

  static int _int(Object? value, {int fallback = 0}) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? fallback;
    return fallback;
  }
}

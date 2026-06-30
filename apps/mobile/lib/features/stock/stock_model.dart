/// Item de estoque (GET /v1/stock).
class StockItem {
  const StockItem({
    required this.id,
    required this.name,
    this.sku,
    this.unit,
    this.category,
    required this.quantity,
    required this.minQty,
    this.maxQty,
    this.isLowStock = false,
    this.shortage,
  });

  final String id;
  final String name;
  final String? sku;
  final String? unit;
  final String? category;
  final num quantity;
  final num minQty;
  final num? maxQty;
  final bool isLowStock;
  final num? shortage;

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  factory StockItem.fromJson(Map<String, dynamic> json) {
    final qty = _n(json['quantity']);
    final min = _n(json['min_qty']);
    return StockItem(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      sku: json['sku']?.toString(),
      unit: json['unit']?.toString(),
      category: json['category']?.toString(),
      quantity: qty,
      minQty: min,
      maxQty: json['max_qty'] == null ? null : _n(json['max_qty']),
      isLowStock: json['is_low_stock'] == true || qty <= min,
      shortage: json['shortage'] == null ? null : _n(json['shortage']),
    );
  }
}

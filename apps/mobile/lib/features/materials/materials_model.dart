/// Material (produto, serviço, matéria-prima ou ativo).
class MaterialItem {
  const MaterialItem({
    required this.id,
    required this.name,
    this.sku,
    this.description,
    this.type,
    this.category,
    this.unit,
    this.salePrice,
    this.costPrice,
    this.ncmCode,
    this.isActive = true,
    this.tracksInventory = false,
    this.raw = const {},
  });

  final String id;
  final String name;
  final String? sku;
  final String? description;
  final String? type;
  final String? category;
  final String? unit;
  final num? salePrice;
  final num? costPrice;
  final String? ncmCode;
  final bool isActive;
  final bool tracksInventory;
  final Map<String, dynamic> raw;

  String get typeLabel => switch (type) {
        'product' => 'Produto',
        'service' => 'Serviço',
        'raw_material' => 'Matéria-prima',
        'asset' => 'Ativo',
        _ => type ?? '—',
      };

  static String? _s(Object? v) {
    if (v == null) return null;
    final s = v.toString();
    return s.isEmpty ? null : s;
  }

  static num? _n(Object? v) {
    if (v == null) return null;
    if (v is num) return v;
    return num.tryParse(v.toString());
  }

  factory MaterialItem.fromJson(Map<String, dynamic> json) {
    return MaterialItem(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      sku: _s(json['sku']),
      description: _s(json['description']),
      type: _s(json['type']),
      category: _s(json['category']),
      unit: _s(json['unit']),
      salePrice: _n(json['sale_price']),
      costPrice: _n(json['cost_price']),
      ncmCode: _s(json['ncm_code']),
      isActive: json['is_active'] != false,
      tracksInventory: json['tracks_inventory'] == true,
      raw: json,
    );
  }
}

/// Saldo de estoque de um material (GET /v1/materials/:id/stock).
class MaterialStock {
  const MaterialStock({
    required this.quantity,
    required this.minQty,
    this.maxQty,
    this.isLowStock = false,
  });

  final num quantity;
  final num minQty;
  final num? maxQty;
  final bool isLowStock;

  factory MaterialStock.fromJson(Map<String, dynamic> json) {
    num n(Object? v) =>
        v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
    return MaterialStock(
      quantity: n(json['quantity']),
      minQty: n(json['min_qty']),
      maxQty: json['max_qty'] == null ? null : n(json['max_qty']),
      isLowStock: json['is_low_stock'] == true,
    );
  }
}

/// Pedido de venda.
class Order {
  const Order({
    required this.id,
    required this.number,
    required this.status,
    this.clientName,
    this.clientId,
    this.subtotal,
    this.discount,
    this.shipping,
    required this.total,
    this.notes,
    this.createdAt,
    this.items = const [],
    this.raw = const {},
  });

  final String id;
  final String number;
  final String status;
  final String? clientName;
  final String? clientId;
  final num? subtotal;
  final num? discount;
  final num? shipping;
  final num total;
  final String? notes;
  final String? createdAt;
  final List<OrderItem> items;
  final Map<String, dynamic> raw;

  bool get isDraft => status == 'draft';
  bool get isConfirmed => status == 'confirmed';
  bool get isDelivered => status == 'delivered';
  bool get canCancel => status == 'draft' || status == 'confirmed';

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  factory Order.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? const [];
    return Order(
      id: json['id']?.toString() ?? '',
      number: json['number']?.toString() ?? '',
      status: json['status']?.toString() ?? 'draft',
      clientName: json['client_name']?.toString(),
      clientId: json['client_id']?.toString(),
      subtotal: json['subtotal'] == null ? null : _n(json['subtotal']),
      discount: json['discount'] == null ? null : _n(json['discount']),
      shipping: json['shipping'] == null ? null : _n(json['shipping']),
      total: _n(json['total']),
      notes: json['notes']?.toString(),
      createdAt: json['created_at']?.toString(),
      items: rawItems
          .map((e) => OrderItem.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      raw: json,
    );
  }
}

class OrderItem {
  const OrderItem({
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.total,
    this.unit,
    this.sku,
    this.materialId,
  });

  final String name;
  final num quantity;
  final num unitPrice;
  final num total;
  final String? unit;
  final String? sku;
  final String? materialId;

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    num n(Object? v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
    return OrderItem(
      name: json['name']?.toString() ?? '',
      quantity: n(json['quantity']),
      unitPrice: n(json['unit_price']),
      total: n(json['total']),
      unit: json['unit']?.toString(),
      sku: json['sku']?.toString(),
      materialId: json['material_id']?.toString(),
    );
  }
}

/// Linha em construção no formulário de novo pedido.
class DraftItem {
  DraftItem({
    required this.name,
    required this.quantity,
    required this.unitPrice,
    this.materialId,
    this.unit,
  });

  final String name;
  num quantity;
  num unitPrice;
  final String? materialId;
  final String? unit;

  num get total => quantity * unitPrice;

  Map<String, dynamic> toJson() => {
        'name': name,
        'quantity': quantity,
        'unit_price': unitPrice,
        if (materialId != null) 'material_id': materialId,
        if (unit != null) 'unit': unit,
      };
}

/// Centro de custo.
class CostCenter {
  const CostCenter({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.allowNegative = false,
    this.isActive = true,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final bool allowNegative;
  final bool isActive;

  factory CostCenter.fromJson(Map<String, dynamic> json) => CostCenter(
        id: json['id']?.toString() ?? '',
        code: json['code']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        description: json['description']?.toString(),
        allowNegative: json['allow_negative'] == true,
        isActive: json['is_active'] != false,
      );
}

/// Saldo de um material no centro de custo.
class CostCenterStock {
  const CostCenterStock({
    required this.materialId,
    required this.materialName,
    required this.quantity,
    required this.avgUnitCost,
    required this.totalValue,
  });

  final String materialId;
  final String materialName;
  final num quantity;
  final num avgUnitCost;
  final num totalValue;

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  factory CostCenterStock.fromJson(Map<String, dynamic> json) =>
      CostCenterStock(
        materialId: json['material_id']?.toString() ?? '',
        materialName: json['material_name']?.toString() ?? '',
        quantity: _n(json['quantity']),
        avgUnitCost: _n(json['avg_unit_cost']),
        totalValue: _n(json['total_value']),
      );
}

/// Movimento do ledger do centro de custo.
class CostCenterMovement {
  const CostCenterMovement({
    required this.id,
    required this.direction,
    required this.quantity,
    required this.unitCost,
    required this.totalCost,
    this.balanceAfter,
    this.source,
    this.note,
    this.occurredAt,
    this.materialName,
  });

  final String id;
  final String direction; // 'in' | 'out'
  final num quantity;
  final num unitCost;
  final num totalCost;
  final num? balanceAfter;
  final String? source;
  final String? note;
  final String? occurredAt;
  final String? materialName;

  bool get isIn => direction == 'in';

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  factory CostCenterMovement.fromJson(Map<String, dynamic> json) =>
      CostCenterMovement(
        id: json['id']?.toString() ?? '',
        direction: json['direction']?.toString() ?? 'in',
        quantity: _n(json['quantity']),
        unitCost: _n(json['unit_cost']),
        totalCost: _n(json['total_cost']),
        balanceAfter:
            json['balance_after'] == null ? null : _n(json['balance_after']),
        source: json['source']?.toString(),
        note: json['note']?.toString(),
        occurredAt: json['occurred_at']?.toString(),
        materialName: json['material_name']?.toString(),
      );
}

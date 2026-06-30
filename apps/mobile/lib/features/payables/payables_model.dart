/// Conta a pagar.
class Payable {
  const Payable({
    required this.id,
    required this.description,
    required this.amount,
    required this.paidAmount,
    this.dueDate,
    required this.status,
    this.supplierName,
    this.category,
    this.notes,
    this.payments = const [],
    this.raw = const {},
  });

  final String id;
  final String description;
  final num amount;
  final num paidAmount;
  final String? dueDate;
  final String status;
  final String? supplierName;
  final String? category;
  final String? notes;
  final List<Map<String, dynamic>> payments;
  final Map<String, dynamic> raw;

  num get openAmount => amount - paidAmount;
  bool get isOpen => status == 'pending' || status == 'partial';

  String get categoryLabel => switch (category) {
        'services' => 'Serviços',
        'supplies' => 'Suprimentos',
        'utilities' => 'Utilidades',
        'rent' => 'Aluguel',
        'payroll' => 'Folha',
        'taxes' => 'Impostos',
        'other' => 'Outros',
        _ => category ?? '—',
      };

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  static String? _s(Object? v) {
    final s = v?.toString();
    return (s == null || s.isEmpty) ? null : s;
  }

  factory Payable.fromJson(Map<String, dynamic> json) {
    final pays = json['payments'] as List<dynamic>? ?? const [];
    return Payable(
      id: json['id']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      amount: _n(json['amount']),
      paidAmount: _n(json['paid_amount']),
      dueDate: _s(json['due_date']),
      status: json['status']?.toString() ?? 'pending',
      supplierName: _s(json['supplier_name']),
      category: _s(json['category']),
      notes: _s(json['notes']),
      payments: pays.map((e) => e as Map<String, dynamic>).toList(),
      raw: json,
    );
  }
}

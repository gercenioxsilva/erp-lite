/// Conta a receber.
class Receivable {
  const Receivable({
    required this.id,
    required this.description,
    required this.amount,
    required this.paidAmount,
    this.dueDate,
    required this.status,
    this.clientName,
    this.invoiceId,
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
  final String? clientName;
  final String? invoiceId;
  final String? notes;
  final List<Map<String, dynamic>> payments;
  final Map<String, dynamic> raw;

  num get openAmount => amount - paidAmount;
  bool get isOpen => status == 'pending' || status == 'partial';
  bool get isCancelled => status == 'cancelled';

  /// Linha digitável do boleto, se já emitido (pode estar no raw).
  String? get boletoLine =>
      (raw['linha_digitavel'] ?? raw['boleto_line'])?.toString();
  String? get boletoUrl =>
      (raw['boleto_url'] ?? raw['url_pdf'])?.toString();

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  static String? _s(Object? v) {
    final s = v?.toString();
    return (s == null || s.isEmpty) ? null : s;
  }

  factory Receivable.fromJson(Map<String, dynamic> json) {
    final pays = json['payments'] as List<dynamic>? ?? const [];
    return Receivable(
      id: json['id']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      amount: _n(json['amount']),
      paidAmount: _n(json['paid_amount']),
      dueDate: _s(json['due_date']),
      status: json['status']?.toString() ?? 'pending',
      clientName: _s(json['client_name']),
      invoiceId: _s(json['invoice_id']),
      notes: _s(json['notes']),
      payments: pays.map((e) => e as Map<String, dynamic>).toList(),
      raw: json,
    );
  }
}

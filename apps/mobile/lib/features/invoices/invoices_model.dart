/// Nota Fiscal (NF-e de produto).
class Invoice {
  const Invoice({
    required this.id,
    required this.number,
    this.serie,
    required this.status,
    this.issueDate,
    this.subtotal,
    required this.total,
    this.clientName,
    this.orderNumber,
    this.nfeStatus,
    this.nfeChave,
    this.nfeRejectReason,
    this.nfeDanfeUrl,
    this.items = const [],
    this.raw = const {},
  });

  final String id;
  final String number;
  final String? serie;
  final String status;
  final String? issueDate;
  final num? subtotal;
  final num total;
  final String? clientName;
  final String? orderNumber;
  final String? nfeStatus;
  final String? nfeChave;
  final String? nfeRejectReason;
  final String? nfeDanfeUrl;
  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> raw;

  /// Status efetivo para o badge: usa nfe_status quando existe.
  String get effectiveStatus => nfeStatus ?? status;
  bool get isDraft => nfeStatus == null && status != 'cancelled';
  bool get isAuthorized => nfeStatus == 'authorized';
  bool get canEmit => isDraft;
  bool get canCancel => status != 'cancelled' && nfeStatus != 'rejected';
  bool get hasDanfe => (nfeDanfeUrl ?? '').isNotEmpty;

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  static String? _s(Object? v) {
    final s = v?.toString();
    return (s == null || s.isEmpty) ? null : s;
  }

  factory Invoice.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? const [];
    return Invoice(
      id: json['id']?.toString() ?? '',
      number: json['number']?.toString() ?? '',
      serie: _s(json['serie']),
      status: json['status']?.toString() ?? 'draft',
      issueDate: _s(json['issue_date']),
      subtotal: json['subtotal'] == null ? null : _n(json['subtotal']),
      total: _n(json['total']),
      clientName: _s(json['client_name']),
      orderNumber: _s(json['order_number']),
      nfeStatus: _s(json['nfe_status']),
      nfeChave: _s(json['nfe_chave']),
      nfeRejectReason: _s(json['nfe_reject_reason']),
      nfeDanfeUrl: _s(json['nfe_danfe_url']),
      items: rawItems.map((e) => e as Map<String, dynamic>).toList(),
      raw: json,
    );
  }
}

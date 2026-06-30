/// Proposta comercial.
class Proposal {
  const Proposal({
    required this.id,
    required this.number,
    required this.title,
    required this.status,
    this.total,
    this.validUntil,
    this.clientName,
    this.clientEmail,
    this.publicToken,
    this.convertedToOrderId,
    this.items = const [],
    this.raw = const {},
  });

  final String id;
  final String number;
  final String title;
  final String status;
  final num? total;
  final String? validUntil;
  final String? clientName;
  final String? clientEmail;
  final String? publicToken;
  final String? convertedToOrderId;
  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> raw;

  bool get isDraft => status == 'draft';
  bool get isAccepted => status == 'accepted';
  bool get canSend => status == 'draft';
  bool get canConvert => status == 'accepted' && convertedToOrderId == null;
  bool get canCancel =>
      status != 'cancelled' && status != 'expired' && convertedToOrderId == null;

  static num _n(Object? v) =>
      v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  static String? _s(Object? v) {
    final s = v?.toString();
    return (s == null || s.isEmpty) ? null : s;
  }

  factory Proposal.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? const [];
    return Proposal(
      id: json['id']?.toString() ?? '',
      number: json['number']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      status: json['status']?.toString() ?? 'draft',
      total: json['total'] == null ? null : _n(json['total']),
      validUntil: _s(json['valid_until']),
      clientName: _s(json['client_name']),
      clientEmail: _s(json['client_email']),
      publicToken: _s(json['public_token']),
      convertedToOrderId: _s(json['converted_to_order_id']),
      items: rawItems.map((e) => e as Map<String, dynamic>).toList(),
      raw: json,
    );
  }
}

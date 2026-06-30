/// Cliente (PJ ou PF). Mantém o JSON cru para edição completa no formulário.
class Client {
  const Client({
    required this.id,
    required this.personType,
    this.companyName,
    this.tradeName,
    this.fullName,
    this.cnpj,
    this.cpf,
    this.email,
    this.phone,
    this.mobile,
    this.city,
    this.state,
    this.isActive = true,
    this.raw = const {},
  });

  final String id;
  final String personType; // 'PJ' | 'PF'
  final String? companyName;
  final String? tradeName;
  final String? fullName;
  final String? cnpj;
  final String? cpf;
  final String? email;
  final String? phone;
  final String? mobile;
  final String? city;
  final String? state;
  final bool isActive;
  final Map<String, dynamic> raw;

  bool get isPJ => personType == 'PJ';

  /// Nome de exibição: razão social (PJ) ou nome completo (PF).
  String get displayName {
    final name = isPJ ? (companyName ?? tradeName) : fullName;
    return (name == null || name.isEmpty) ? 'Sem nome' : name;
  }

  String get document => isPJ ? (cnpj ?? '') : (cpf ?? '');

  static String? _s(Object? v) {
    if (v == null) return null;
    final s = v.toString();
    return s.isEmpty ? null : s;
  }

  factory Client.fromJson(Map<String, dynamic> json) {
    return Client(
      id: json['id']?.toString() ?? '',
      personType: json['person_type']?.toString() ?? 'PJ',
      companyName: _s(json['company_name']),
      tradeName: _s(json['trade_name']),
      fullName: _s(json['full_name']),
      cnpj: _s(json['cnpj']),
      cpf: _s(json['cpf']),
      email: _s(json['email']),
      phone: _s(json['phone']),
      mobile: _s(json['mobile']),
      city: _s(json['city']),
      state: _s(json['state']),
      isActive: json['is_active'] != false,
      raw: json,
    );
  }
}

/// Histórico 360° do cliente (GET /v1/clients/:id/history).
class ClientHistory {
  const ClientHistory({
    this.orders = const [],
    this.invoices = const [],
    this.receivables = const [],
  });

  final List<Map<String, dynamic>> orders;
  final List<Map<String, dynamic>> invoices;
  final List<Map<String, dynamic>> receivables;

  factory ClientHistory.fromJson(Map<String, dynamic> json) {
    List<Map<String, dynamic>> list(Object? v) =>
        (v as List<dynamic>? ?? const [])
            .map((e) => e as Map<String, dynamic>)
            .toList(growable: false);
    return ClientHistory(
      orders: list(json['orders']),
      invoices: list(json['invoices']),
      receivables: list(json['receivables']),
    );
  }
}

/// Fornecedor (PJ ou PF).
class Supplier {
  const Supplier({
    required this.id,
    required this.personType,
    this.companyName,
    this.tradeName,
    this.fullName,
    this.cnpj,
    this.cpf,
    this.email,
    this.phone,
    this.city,
    this.state,
    this.category,
    this.isActive = true,
    this.raw = const {},
  });

  final String id;
  final String personType;
  final String? companyName;
  final String? tradeName;
  final String? fullName;
  final String? cnpj;
  final String? cpf;
  final String? email;
  final String? phone;
  final String? city;
  final String? state;
  final String? category;
  final bool isActive;
  final Map<String, dynamic> raw;

  bool get isPJ => personType == 'PJ';

  String get displayName {
    final name = isPJ ? (companyName ?? tradeName) : fullName;
    return (name == null || name.isEmpty) ? 'Sem nome' : name;
  }

  String get document => isPJ ? (cnpj ?? '') : (cpf ?? '');

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

  static String? _s(Object? v) {
    if (v == null) return null;
    final s = v.toString();
    return s.isEmpty ? null : s;
  }

  factory Supplier.fromJson(Map<String, dynamic> json) {
    return Supplier(
      id: json['id']?.toString() ?? '',
      personType: json['person_type']?.toString() ?? 'PJ',
      companyName: _s(json['company_name']),
      tradeName: _s(json['trade_name']),
      fullName: _s(json['full_name']),
      cnpj: _s(json['cnpj']),
      cpf: _s(json['cpf']),
      email: _s(json['email']),
      phone: _s(json['phone']),
      city: _s(json['city']),
      state: _s(json['state']),
      category: _s(json['category']),
      isActive: json['is_active'] != false,
      raw: json,
    );
  }
}

import 'package:intl/intl.dart';

/// Formatação monetária em BRL (Regra Mobile-3).
abstract final class CurrencyFormatter {
  const CurrencyFormatter._();

  static final NumberFormat _brl = NumberFormat.currency(
    locale: 'pt_BR',
    symbol: r'R$',
  );

  /// Aceita num, String numérica ou null. Valores da API vêm como String
  /// (NUMERIC do Postgres serializa como string via pg/Drizzle).
  static String format(Object? value) {
    final number = _toDouble(value);
    return _brl.format(number);
  }

  static double _toDouble(Object? value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }
}

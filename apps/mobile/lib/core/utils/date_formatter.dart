import 'package:intl/intl.dart';

/// Formatação de datas no padrão brasileiro (Regra Mobile-4).
abstract final class DateFormatter {
  const DateFormatter._();

  static final DateFormat _date = DateFormat('dd/MM/yyyy', 'pt_BR');
  static final DateFormat _dateTime = DateFormat('dd/MM/yyyy HH:mm', 'pt_BR');

  /// Aceita String ISO-8601, DateTime ou null.
  static String date(Object? value) {
    final parsed = _parse(value);
    if (parsed == null) return '—';
    return _date.format(parsed.toLocal());
  }

  static String dateTime(Object? value) {
    final parsed = _parse(value);
    if (parsed == null) return '—';
    return _dateTime.format(parsed.toLocal());
  }

  static DateTime? _parse(Object? value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    if (value is String && value.isNotEmpty) return DateTime.tryParse(value);
    return null;
  }
}

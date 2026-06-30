import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';

/// Exibe um valor monetário formatado em BRL (Regra Mobile-3).
class CurrencyText extends StatelessWidget {
  const CurrencyText(
    this.value, {
    super.key,
    this.style,
    this.color,
  });

  final Object? value;
  final TextStyle? style;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      CurrencyFormatter.format(value),
      style: (style ?? const TextStyle(fontWeight: FontWeight.w700)).copyWith(
        color: color ?? AppColors.text,
      ),
    );
  }
}

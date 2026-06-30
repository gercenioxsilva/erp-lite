import 'package:flutter/material.dart';

/// Paleta oficial do Orquestra ERP — idêntica ao backoffice web.
/// Regra Mobile-5: identidade visual consistente com o web.
abstract final class AppColors {
  const AppColors._();

  // Marca
  static const Color primary = Color(0xFF3B5CE4); // azul Orquestra
  static const Color primaryHover = Color(0xFF2945C8);
  static const Color accent = Color(0xFF00B4D8); // ciano

  // Superfícies
  static const Color background = Color(0xFFF9FAFB);
  static const Color surface = Colors.white;
  static const Color border = Color(0xFFE5E7EB);

  // Texto
  static const Color text = Color(0xFF111827);
  static const Color textMuted = Color(0xFF6B7280);
  static const Color textInverse = Colors.white;

  // Status semânticos
  static const Color success = Color(0xFF16A34A);
  static const Color warning = Color(0xFFD97706);
  static const Color danger = Color(0xFFDC2626);
  static const Color info = Color(0xFF2563EB);

  static const Color successBg = Color(0xFFDCFCE7);
  static const Color warningBg = Color(0xFFFEF3C7);
  static const Color dangerBg = Color(0xFFFEE2E2);
  static const Color infoBg = Color(0xFFDBEAFE);
  static const Color neutralBg = Color(0xFFF3F4F6);
}

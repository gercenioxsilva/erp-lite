import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

/// Indicador de carregamento centralizado (Regra Mobile-10).
class LoadingOverlay extends StatelessWidget {
  const LoadingOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: AppColors.primary),
    );
  }
}

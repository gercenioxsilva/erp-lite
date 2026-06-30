import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

/// Card de erro com mensagem e ação de retry (Regra Mobile-8/10).
class ErrorCard extends StatelessWidget {
  const ErrorCard({
    super.key,
    required this.message,
    this.onRetry,
  });

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.danger),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.text, fontSize: 15),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text(S.retry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

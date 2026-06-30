import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

/// Marca Orquestra ERP: nó central + wordmark com gradiente azul→ciano.
/// Equivalente mobile do GaxLogo.tsx do web (Regra 17).
class OrquestraLogo extends StatelessWidget {
  const OrquestraLogo({super.key, this.size = 36, this.showWordmark = true});

  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [AppColors.primary, AppColors.accent],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.hub_outlined,
        color: Colors.white,
        size: size * 0.58,
      ),
    );

    if (!showWordmark) return mark;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        mark,
        SizedBox(width: size * 0.3),
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Orquestra',
              style: TextStyle(
                fontSize: size * 0.52,
                fontWeight: FontWeight.w800,
                color: AppColors.text,
                height: 1,
              ),
            ),
            Text(
              S.appName.split(' ').last,
              style: TextStyle(
                fontSize: size * 0.3,
                fontWeight: FontWeight.w600,
                color: AppColors.accent,
                letterSpacing: 2,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';
import 'package:orquestra_mobile/features/materials/materials_provider.dart';

class MaterialDetailPage extends ConsumerWidget {
  const MaterialDetailPage({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(materialDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('Material')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(materialDetailProvider(id)),
        ),
        data: (m) => _buildContent(ref, m),
      ),
    );
  }

  Widget _buildContent(WidgetRef ref, MaterialItem m) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          m.name,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            StatusBadge(m.isActive ? 'active' : 'disabled'),
            const SizedBox(width: 8),
            Text(m.typeLabel,
                style: const TextStyle(color: AppColors.textMuted)),
          ],
        ),
        const SizedBox(height: 16),
        _card([
          _row('SKU', m.sku),
          _row('Categoria', m.category),
          _row('Unidade', m.unit),
          _row('NCM', m.ncmCode),
          _row('Preço de venda', m.salePrice == null
              ? null
              : CurrencyFormatter.format(m.salePrice)),
          _row('Preço de custo', m.costPrice == null
              ? null
              : CurrencyFormatter.format(m.costPrice)),
        ]),
        if (m.description != null) ...[
          const SizedBox(height: 16),
          _card([_row('Descrição', m.description)]),
        ],
        const SizedBox(height: 16),
        if (m.tracksInventory) _buildStock(ref),
      ],
    );
  }

  Widget _buildStock(WidgetRef ref) {
    final stock = ref.watch(materialStockProvider(id));
    return stock.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (s) {
        if (s == null) return const SizedBox.shrink();
        return Card(
          color: s.isLowStock ? AppColors.dangerBg : AppColors.successBg,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(
                  s.isLowStock
                      ? Icons.warning_amber_rounded
                      : Icons.check_circle_outline,
                  color: s.isLowStock ? AppColors.danger : AppColors.success,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Saldo: ${s.quantity}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      Text('Mínimo: ${s.minQty}',
                          style: const TextStyle(color: AppColors.textMuted)),
                    ],
                  ),
                ),
                if (s.isLowStock)
                  const StatusBadge('overdue')
                else
                  const StatusBadge('active'),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _card(List<Widget> rows) {
    final visible = rows.where((w) => w is! SizedBox).toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: visible),
      ),
    );
  }

  Widget _row(String label, String? value) {
    if (value == null || value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label,
                style:
                    const TextStyle(color: AppColors.textMuted, fontSize: 13)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_model.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_provider.dart';

class SupplierDetailPage extends ConsumerWidget {
  const SupplierDetailPage({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(supplierDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('Fornecedor')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(supplierDetailProvider(id)),
        ),
        data: (s) => _buildContent(ref, s),
      ),
    );
  }

  Widget _buildContent(WidgetRef ref, Supplier s) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(s.displayName,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Row(
          children: [
            StatusBadge(s.isActive ? 'active' : 'disabled'),
            const SizedBox(width: 8),
            Text(s.categoryLabel,
                style: const TextStyle(color: AppColors.textMuted)),
          ],
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _row(s.isPJ ? 'CNPJ' : 'CPF', s.document),
                _row('E-mail', s.email),
                _row('Telefone', s.phone),
                _row('Cidade', s.city),
                _row('UF', s.state),
              ].whereType<Widget>().toList(),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text('Contas a pagar',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: 8),
        _buildPayables(ref),
      ],
    );
  }

  Widget _buildPayables(WidgetRef ref) {
    final payables = ref.watch(supplierPayablesProvider(id));
    return payables.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('Nenhuma conta a pagar vinculada',
                  style: TextStyle(color: AppColors.textMuted)),
            ),
          );
        }
        return Column(
          children: items.map((p) {
            return Card(
              child: ListTile(
                title: Text(p['description']?.toString() ?? 'Conta'),
                subtitle: Text('Venc. ${DateFormatter.date(p['due_date'])}'),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(CurrencyFormatter.format(p['amount']),
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    if (p['status'] != null)
                      StatusBadge(p['status'].toString()),
                  ],
                ),
              ),
            );
          }).toList(),
        );
      },
    );
  }

  Widget? _row(String label, String? value) {
    if (value == null || value.isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
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

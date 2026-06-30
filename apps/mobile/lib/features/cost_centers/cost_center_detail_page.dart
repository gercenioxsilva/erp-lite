import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/empty_state.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_model.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_provider.dart';
import 'package:orquestra_mobile/features/cost_centers/entry_bottom_sheet.dart';

class CostCenterDetailPage extends ConsumerWidget {
  const CostCenterDetailPage({super.key, required this.id});

  final String id;

  Future<void> _openEntry(BuildContext context) async {
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => EntryBottomSheet(costCenterId: id),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(costCenterDetailProvider(id));
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(detail.valueOrNull?.name ?? 'Centro de Custo'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Estoque'),
              Tab(text: 'Movimentações'),
            ],
          ),
        ),
        body: detail.when(
          loading: () => const LoadingOverlay(),
          error: (err, _) => ErrorCard(
            message: err.toString(),
            onRetry: () => ref.invalidate(costCenterDetailProvider(id)),
          ),
          data: (cc) => TabBarView(
            children: [
              _StockTab(id: id),
              _MovementsTab(id: id),
            ],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _openEntry(context),
          icon: const Icon(Icons.add),
          label: const Text('Entrada'),
        ),
      ),
    );
  }
}

class _StockTab extends ConsumerWidget {
  const _StockTab({required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stock = ref.watch(costCenterStockProvider(id));
    return stock.when(
      loading: () => const LoadingOverlay(),
      error: (err, _) => ErrorCard(
        message: err.toString(),
        onRetry: () => ref.invalidate(costCenterStockProvider(id)),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const EmptyState(message: 'Sem saldo neste centro de custo');
        }
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async => ref.invalidate(costCenterStockProvider(id)),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) => _stockTile(items[i]),
          ),
        );
      },
    );
  }

  Widget _stockTile(CostCenterStock s) {
    return Card(
      child: ListTile(
        title: Text(s.materialName,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
            'Qtd ${s.quantity} · Custo méd. ${CurrencyFormatter.format(s.avgUnitCost)}'),
        trailing: Text(
          CurrencyFormatter.format(s.totalValue),
          style: const TextStyle(
              fontWeight: FontWeight.w700, color: AppColors.primary),
        ),
      ),
    );
  }
}

class _MovementsTab extends ConsumerWidget {
  const _MovementsTab({required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final movements = ref.watch(costCenterMovementsProvider(id));
    return movements.when(
      loading: () => const LoadingOverlay(),
      error: (err, _) => ErrorCard(
        message: err.toString(),
        onRetry: () => ref.invalidate(costCenterMovementsProvider(id)),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const EmptyState(message: 'Nenhuma movimentação');
        }
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async =>
              ref.invalidate(costCenterMovementsProvider(id)),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) => _movementTile(items[i]),
          ),
        );
      },
    );
  }

  Widget _movementTile(CostCenterMovement m) {
    final color = m.isIn ? AppColors.success : AppColors.danger;
    return Card(
      child: ListTile(
        leading: Icon(
          m.isIn ? Icons.add_circle_outline : Icons.remove_circle_outline,
          color: color,
        ),
        title: Text(m.materialName ?? 'Material',
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          [
            '${m.isIn ? '+' : '-'}${m.quantity}',
            if (m.source != null) m.source,
            if (m.occurredAt != null) DateFormatter.date(m.occurredAt),
          ].join(' · '),
        ),
        trailing: Text(
          CurrencyFormatter.format(m.totalCost),
          style: TextStyle(fontWeight: FontWeight.w700, color: color),
        ),
      ),
    );
  }
}

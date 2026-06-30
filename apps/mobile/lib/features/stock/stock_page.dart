import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/empty_state.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/stock/stock_model.dart';
import 'package:orquestra_mobile/features/stock/stock_provider.dart';

class StockPage extends ConsumerWidget {
  const StockPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        body: Column(
          children: [
            const Material(
              color: AppColors.surface,
              child: TabBar(
                labelColor: AppColors.primary,
                indicatorColor: AppColors.primary,
                tabs: [
                  Tab(text: 'Estoque'),
                  Tab(text: 'Alertas'),
                ],
              ),
            ),
            Expanded(
              child: TabBarView(
                children: [
                  _StockList(),
                  _AlertsList(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StockList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(stockProvider);
    final notifier = ref.read(stockProvider.notifier);
    return PagedListBody<StockItem>(
      state: state,
      searchHint: 'Buscar por nome ou SKU',
      emptyMessage: 'Nenhum item em estoque',
      onSearch: notifier.setSearch,
      onRefresh: notifier.refresh,
      onLoadMore: notifier.loadMore,
      itemBuilder: (context, item, _) => _StockTile(item: item),
    );
  }
}

class _AlertsList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alerts = ref.watch(stockAlertsProvider);
    return alerts.when(
      loading: () => const LoadingOverlay(),
      error: (err, _) => ErrorCard(
        message: err.toString(),
        onRetry: () => ref.invalidate(stockAlertsProvider),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const EmptyState(
            icon: Icons.check_circle_outline,
            message: 'Nenhum item abaixo do mínimo',
          );
        }
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async => ref.invalidate(stockAlertsProvider),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) => _StockTile(item: items[i], alert: true),
          ),
        );
      },
    );
  }
}

class _StockTile extends StatelessWidget {
  const _StockTile({required this.item, this.alert = false});

  final StockItem item;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    final low = item.isLowStock;
    return Card(
      child: ListTile(
        leading: Icon(
          low ? Icons.warning_amber_rounded : Icons.inventory_2_outlined,
          color: low ? AppColors.danger : AppColors.primary,
        ),
        title: Text(
          item.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            if (item.sku != null) 'SKU ${item.sku}',
            'Mín. ${item.minQty}',
            if (alert && item.shortage != null) 'Faltam ${item.shortage}',
          ].join(' · '),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Text(
          '${item.quantity}${item.unit != null ? ' ${item.unit}' : ''}',
          style: TextStyle(
            fontWeight: FontWeight.w800,
            color: low ? AppColors.danger : AppColors.text,
          ),
        ),
      ),
    );
  }
}

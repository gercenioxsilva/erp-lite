import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';
import 'package:orquestra_mobile/features/orders/orders_provider.dart';

class OrdersListPage extends ConsumerWidget {
  const OrdersListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(ordersProvider);
    final notifier = ref.read(ordersProvider.notifier);

    return Scaffold(
      body: PagedListBody<Order>(
        state: state,
        searchHint: 'Buscar por número ou cliente',
        emptyMessage: 'Nenhum pedido cadastrado',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, order, _) => Card(
          child: ListTile(
            onTap: () => context.push('/orders/${order.id}'),
            title: Text(
              'Pedido ${order.number}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              [
                order.clientName ?? 'Sem cliente',
                if (order.createdAt != null)
                  DateFormatter.date(order.createdAt),
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  CurrencyFormatter.format(order.total),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 4),
                StatusBadge(order.status),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/orders/new'),
        icon: const Icon(Icons.add),
        label: const Text('Novo'),
      ),
    );
  }
}

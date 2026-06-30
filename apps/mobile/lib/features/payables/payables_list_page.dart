import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/payables/payables_model.dart';
import 'package:orquestra_mobile/features/payables/payables_provider.dart';

class PayablesListPage extends ConsumerWidget {
  const PayablesListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(payablesProvider);
    final notifier = ref.read(payablesProvider.notifier);

    return Scaffold(
      body: PagedListBody<Payable>(
        state: state,
        searchHint: 'Buscar por descrição ou fornecedor',
        emptyMessage: 'Nenhuma conta a pagar',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, p, _) => Card(
          child: ListTile(
            onTap: () => context.push('/payables/${p.id}'),
            title: Text(
              p.description,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              [
                if (p.supplierName != null) p.supplierName,
                if (p.dueDate != null) 'Venc. ${DateFormatter.date(p.dueDate)}',
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  CurrencyFormatter.format(p.openAmount),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.warning,
                  ),
                ),
                const SizedBox(height: 4),
                StatusBadge(p.status),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

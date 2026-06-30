import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/invoices/invoices_model.dart';
import 'package:orquestra_mobile/features/invoices/invoices_provider.dart';

class InvoicesListPage extends ConsumerWidget {
  const InvoicesListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(invoicesProvider);
    final notifier = ref.read(invoicesProvider.notifier);

    return Scaffold(
      body: PagedListBody<Invoice>(
        state: state,
        searchHint: 'Buscar por número ou cliente',
        emptyMessage: 'Nenhuma nota fiscal',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, inv, _) => Card(
          child: ListTile(
            onTap: () => context.push('/invoices/${inv.id}'),
            title: Text(
              'NF ${inv.number}${inv.serie != null ? '/${inv.serie}' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              [
                inv.clientName ?? 'Sem cliente',
                if (inv.issueDate != null) DateFormatter.date(inv.issueDate),
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  CurrencyFormatter.format(inv.total),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 4),
                StatusBadge(inv.effectiveStatus),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

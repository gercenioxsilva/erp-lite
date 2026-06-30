import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/receivables/receivables_model.dart';
import 'package:orquestra_mobile/features/receivables/receivables_provider.dart';

class ReceivablesListPage extends ConsumerWidget {
  const ReceivablesListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(receivablesProvider);
    final notifier = ref.read(receivablesProvider.notifier);

    return Scaffold(
      body: PagedListBody<Receivable>(
        state: state,
        searchHint: 'Buscar por descrição ou cliente',
        emptyMessage: 'Nenhuma conta a receber',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, r, _) => Card(
          child: ListTile(
            onTap: () => context.push('/receivables/${r.id}'),
            title: Text(
              r.description,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              [
                if (r.clientName != null) r.clientName,
                if (r.dueDate != null) 'Venc. ${DateFormatter.date(r.dueDate)}',
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  CurrencyFormatter.format(r.openAmount),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.success,
                  ),
                ),
                const SizedBox(height: 4),
                StatusBadge(r.status),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

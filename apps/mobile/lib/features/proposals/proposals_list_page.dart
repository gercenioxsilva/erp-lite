import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/proposals/proposals_model.dart';
import 'package:orquestra_mobile/features/proposals/proposals_provider.dart';

class ProposalsListPage extends ConsumerWidget {
  const ProposalsListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(proposalsProvider);
    final notifier = ref.read(proposalsProvider.notifier);

    return Scaffold(
      body: PagedListBody<Proposal>(
        state: state,
        searchHint: 'Buscar por número, título ou cliente',
        emptyMessage: 'Nenhuma proposta',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, p, _) => Card(
          child: ListTile(
            onTap: () => context.push('/proposals/${p.id}'),
            title: Text(
              p.title.isEmpty ? 'Proposta ${p.number}' : p.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              [
                p.clientName ?? 'Sem cliente',
                if (p.validUntil != null)
                  'Validade ${DateFormatter.date(p.validUntil)}',
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (p.total != null)
                  Text(
                    CurrencyFormatter.format(p.total),
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, color: AppColors.primary),
                  ),
                const SizedBox(height: 4),
                StatusBadge(p.status),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/proposals/new'),
        icon: const Icon(Icons.add),
        label: const Text('Nova'),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_model.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_provider.dart';

class CostCentersListPage extends ConsumerWidget {
  const CostCentersListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(costCentersProvider);
    final notifier = ref.read(costCentersProvider.notifier);

    return Scaffold(
      body: PagedListBody<CostCenter>(
        state: state,
        searchHint: 'Buscar por código ou nome',
        emptyMessage: 'Nenhum centro de custo',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, cc, _) => Card(
          child: ListTile(
            onTap: () => context.push('/cost-centers/${cc.id}'),
            leading: CircleAvatar(
              backgroundColor: AppColors.infoBg,
              child: Text(
                cc.code.isNotEmpty ? cc.code[0].toUpperCase() : '#',
                style: const TextStyle(
                    color: AppColors.primary, fontWeight: FontWeight.w700),
              ),
            ),
            title: Text(
              cc.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text('Código ${cc.code}'),
            trailing: StatusBadge(cc.isActive ? 'active' : 'disabled'),
          ),
        ),
      ),
    );
  }
}

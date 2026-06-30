import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_model.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_provider.dart';

class SuppliersListPage extends ConsumerWidget {
  const SuppliersListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(suppliersProvider);
    final notifier = ref.read(suppliersProvider.notifier);

    return Scaffold(
      body: PagedListBody<Supplier>(
        state: state,
        searchHint: 'Buscar fornecedor',
        emptyMessage: 'Nenhum fornecedor cadastrado',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, s, _) => Card(
          child: ListTile(
            onTap: () => context.push('/suppliers/${s.id}'),
            leading: CircleAvatar(
              backgroundColor: AppColors.infoBg,
              child: Icon(
                s.isPJ ? Icons.business : Icons.person,
                color: AppColors.primary,
                size: 20,
              ),
            ),
            title: Text(
              s.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              [s.categoryLabel, if (s.city != null) s.city].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing:
                const Icon(Icons.chevron_right, color: AppColors.textMuted),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';
import 'package:orquestra_mobile/features/clients/clients_provider.dart';

class ClientsListPage extends ConsumerWidget {
  const ClientsListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(clientsProvider);
    final notifier = ref.read(clientsProvider.notifier);

    return Scaffold(
      body: PagedListBody<Client>(
        state: state,
        searchHint: 'Buscar por nome, CNPJ ou CPF',
        emptyMessage: 'Nenhum cliente cadastrado',
        onSearch: notifier.setSearch,
        onRefresh: notifier.refresh,
        onLoadMore: notifier.loadMore,
        itemBuilder: (context, client, _) => _ClientTile(client: client),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/clients/new'),
        icon: const Icon(Icons.add),
        label: const Text('Novo'),
      ),
    );
  }
}

class _ClientTile extends StatelessWidget {
  const _ClientTile({required this.client});

  final Client client;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: () => context.push('/clients/${client.id}'),
        leading: CircleAvatar(
          backgroundColor: AppColors.infoBg,
          child: Icon(
            client.isPJ ? Icons.business : Icons.person,
            color: AppColors.primary,
            size: 20,
          ),
        ),
        title: Text(
          client.displayName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            client.isPJ ? 'PJ' : 'PF',
            if (client.document.isNotEmpty) client.document,
            if (client.city != null) client.city,
          ].join(' · '),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
      ),
    );
  }
}

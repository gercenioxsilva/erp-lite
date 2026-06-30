import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';
import 'package:orquestra_mobile/features/clients/clients_provider.dart';

/// Abre um seletor de cliente e retorna o escolhido (ou null).
Future<Client?> pickClient(BuildContext context) {
  return showModalBottomSheet<Client>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _ClientPickerSheet(),
  );
}

class _ClientPickerSheet extends ConsumerWidget {
  const _ClientPickerSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(clientsProvider);
    final notifier = ref.read(clientsProvider.notifier);
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.8,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Selecionar cliente',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          Expanded(
            child: PagedListBody<Client>(
              state: state,
              searchHint: 'Buscar cliente',
              onSearch: notifier.setSearch,
              onRefresh: notifier.refresh,
              onLoadMore: notifier.loadMore,
              itemBuilder: (context, c, _) => ListTile(
                title: Text(c.displayName),
                subtitle: Text(c.document),
                onTap: () => Navigator.of(context).pop(c),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

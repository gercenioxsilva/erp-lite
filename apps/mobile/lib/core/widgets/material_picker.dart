import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';
import 'package:orquestra_mobile/features/materials/materials_provider.dart';

/// Abre um seletor de material e retorna o escolhido (ou null).
Future<MaterialItem?> pickMaterial(BuildContext context) {
  return showModalBottomSheet<MaterialItem>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _MaterialPickerSheet(),
  );
}

class _MaterialPickerSheet extends ConsumerWidget {
  const _MaterialPickerSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(materialsProvider);
    final notifier = ref.read(materialsProvider.notifier);
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.8,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Selecionar material',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          Expanded(
            child: PagedListBody<MaterialItem>(
              state: state,
              searchHint: 'Buscar material',
              onSearch: notifier.setSearch,
              onRefresh: notifier.refresh,
              onLoadMore: notifier.loadMore,
              itemBuilder: (context, m, _) => ListTile(
                title: Text(m.name),
                subtitle: Text(m.sku ?? m.typeLabel),
                trailing: Text(CurrencyFormatter.format(m.salePrice ?? 0)),
                onTap: () => Navigator.of(context).pop(m),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

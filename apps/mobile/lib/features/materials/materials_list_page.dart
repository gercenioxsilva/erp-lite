import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/materials/barcode_scanner_page.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';
import 'package:orquestra_mobile/features/materials/materials_provider.dart';

class MaterialsListPage extends ConsumerWidget {
  const MaterialsListPage({super.key});

  Future<void> _scan(BuildContext context, WidgetRef ref) async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const BarcodeScannerPage()),
    );
    if (code != null && code.isNotEmpty) {
      await ref.read(materialsProvider.notifier).setSearch(code);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(materialsProvider);
    final notifier = ref.read(materialsProvider.notifier);

    return Scaffold(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: OutlinedButton.icon(
              onPressed: () => _scan(context, ref),
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Escanear código de barras'),
            ),
          ),
          Expanded(
            child: PagedListBody<MaterialItem>(
              state: state,
              searchHint: 'Buscar por nome ou SKU',
              emptyMessage: 'Nenhum material cadastrado',
              onSearch: notifier.setSearch,
              onRefresh: notifier.refresh,
              onLoadMore: notifier.loadMore,
              itemBuilder: (context, m, _) => _MaterialTile(material: m),
            ),
          ),
        ],
      ),
    );
  }
}

class _MaterialTile extends StatelessWidget {
  const _MaterialTile({required this.material});

  final MaterialItem material;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: () => context.push('/materials/${material.id}'),
        title: Text(
          material.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            material.typeLabel,
            if (material.sku != null) 'SKU ${material.sku}',
            if (material.unit != null) material.unit,
          ].join(' · '),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: material.salePrice != null
            ? Text(
                CurrencyFormatter.format(material.salePrice),
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              )
            : const Icon(Icons.chevron_right, color: AppColors.textMuted),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/paged_list_body.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';
import 'package:orquestra_mobile/features/clients/clients_provider.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';
import 'package:orquestra_mobile/features/materials/materials_provider.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';
import 'package:orquestra_mobile/features/orders/orders_provider.dart';

class OrderCreatePage extends ConsumerStatefulWidget {
  const OrderCreatePage({super.key});

  @override
  ConsumerState<OrderCreatePage> createState() => _OrderCreatePageState();
}

class _OrderCreatePageState extends ConsumerState<OrderCreatePage> {
  String? _clientId;
  String? _clientName;
  final List<DraftItem> _items = [];
  bool _saving = false;

  num get _total => _items.fold<num>(0, (s, i) => s + i.total);

  Future<void> _pickClient() async {
    final client = await showModalBottomSheet<Client>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ClientPickerSheet(),
    );
    if (client != null) {
      setState(() {
        _clientId = client.id;
        _clientName = client.displayName;
      });
    }
  }

  Future<void> _addItem() async {
    final material = await showModalBottomSheet<MaterialItem>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _MaterialPickerSheet(),
    );
    if (material == null) return;
    if (!mounted) return;
    final qty = await _askQuantity();
    if (qty == null) return;
    setState(() {
      _items.add(DraftItem(
        name: material.name,
        materialId: material.id,
        unit: material.unit,
        quantity: qty,
        unitPrice: material.salePrice ?? 0,
      ));
    });
  }

  Future<num?> _askQuantity() async {
    final ctrl = TextEditingController(text: '1');
    return showDialog<num>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Quantidade'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Quantidade'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              final v = num.tryParse(ctrl.text.replaceAll(',', '.'));
              Navigator.of(ctx).pop(v != null && v > 0 ? v : null);
            },
            child: const Text('Adicionar'),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (_clientId == null) {
      _toast('Selecione um cliente');
      return;
    }
    if (_items.isEmpty) {
      _toast('Adicione ao menos um item');
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(ordersProvider.notifier).create(
            clientId: _clientId!,
            items: _items,
          );
      if (mounted) {
        _toast('Pedido criado com sucesso');
        context.pop();
      }
    } on ApiException catch (e) {
      _toast(e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? AppColors.danger : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Novo pedido')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(_clientName ?? 'Selecionar cliente'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _saving ? null : _pickClient,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Itens',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              TextButton.icon(
                onPressed: _saving ? null : _addItem,
                icon: const Icon(Icons.add),
                label: const Text('Adicionar'),
              ),
            ],
          ),
          if (_items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text('Nenhum item adicionado',
                    style: TextStyle(color: AppColors.textMuted)),
              ),
            ),
          ..._items.asMap().entries.map((e) => Card(
                child: ListTile(
                  title: Text(e.value.name),
                  subtitle: Text(
                    '${e.value.quantity} × ${CurrencyFormatter.format(e.value.unitPrice)}',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(CurrencyFormatter.format(e.value.total),
                          style:
                              const TextStyle(fontWeight: FontWeight.w700)),
                      IconButton(
                        icon: const Icon(Icons.delete_outline,
                            color: AppColors.danger),
                        onPressed: _saving
                            ? null
                            : () => setState(() => _items.removeAt(e.key)),
                      ),
                    ],
                  ),
                ),
              )),
          const SizedBox(height: 16),
          if (_items.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                'Total: ${CurrencyFormatter.format(_total)}',
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary),
              ),
            ),
          const SizedBox(height: 16),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Criar pedido'),
            ),
          ),
        ],
      ),
    );
  }
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

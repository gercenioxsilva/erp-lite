import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/client_picker.dart';
import 'package:orquestra_mobile/core/widgets/material_picker.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';
import 'package:orquestra_mobile/features/proposals/proposals_provider.dart';

class ProposalCreatePage extends ConsumerStatefulWidget {
  const ProposalCreatePage({super.key});

  @override
  ConsumerState<ProposalCreatePage> createState() =>
      _ProposalCreatePageState();
}

class _ProposalCreatePageState extends ConsumerState<ProposalCreatePage> {
  final _title = TextEditingController();
  String? _clientId;
  String? _clientName;
  DateTime _validUntil = DateTime.now().add(const Duration(days: 15));
  final List<DraftItem> _items = [];
  bool _saving = false;

  num get _total => _items.fold<num>(0, (s, i) => s + i.total);

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pickClient() async {
    final c = await pickClient(context);
    if (c != null) {
      setState(() {
        _clientId = c.id;
        _clientName = c.displayName;
      });
    }
  }

  Future<void> _addItem() async {
    final m = await pickMaterial(context);
    if (m == null || !mounted) return;
    final ctrl = TextEditingController(text: '1');
    final qty = await showDialog<num>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Quantidade'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar')),
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
    if (qty == null) return;
    setState(() {
      _items.add(DraftItem(
        name: m.name,
        materialId: m.id,
        unit: m.unit,
        quantity: qty,
        unitPrice: m.salePrice ?? 0,
      ));
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _validUntil,
      firstDate: DateTime.now(),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _validUntil = picked);
  }

  Future<void> _submit() async {
    if (_clientId == null) return _toast('Selecione um cliente');
    if (_title.text.trim().isEmpty) return _toast('Informe um título');
    if (_items.isEmpty) return _toast('Adicione ao menos um item');
    setState(() => _saving = true);
    final iso =
        '${_validUntil.year.toString().padLeft(4, '0')}-${_validUntil.month.toString().padLeft(2, '0')}-${_validUntil.day.toString().padLeft(2, '0')}';
    try {
      await ref.read(proposalsProvider.notifier).create(
            clientId: _clientId!,
            title: _title.text.trim(),
            validUntil: iso,
            items: _items,
          );
      if (mounted) {
        _toast('Proposta criada');
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
      appBar: AppBar(title: const Text('Nova proposta')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _title,
            enabled: !_saving,
            decoration: const InputDecoration(labelText: 'Título da proposta'),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(_clientName ?? 'Selecionar cliente'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _saving ? null : _pickClient,
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.event_outlined),
              title: Text(
                  'Validade: ${_validUntil.day.toString().padLeft(2, '0')}/${_validUntil.month.toString().padLeft(2, '0')}/${_validUntil.year}'),
              trailing: const Icon(Icons.edit_calendar_outlined),
              onTap: _saving ? null : _pickDate,
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
          ..._items.asMap().entries.map((e) => Card(
                child: ListTile(
                  title: Text(e.value.name),
                  subtitle: Text(
                      '${e.value.quantity} × ${CurrencyFormatter.format(e.value.unitPrice)}'),
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
          if (_items.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Total: ${CurrencyFormatter.format(_total)}',
                    style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primary)),
              ),
            ),
          const SizedBox(height: 20),
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
                  : const Text('Criar proposta'),
            ),
          ),
        ],
      ),
    );
  }
}

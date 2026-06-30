import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/material_picker.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_provider.dart';
import 'package:orquestra_mobile/features/materials/materials_model.dart';

/// Sheet de entrada manual de material no centro de custo.
class EntryBottomSheet extends ConsumerStatefulWidget {
  const EntryBottomSheet({super.key, required this.costCenterId});

  final String costCenterId;

  @override
  ConsumerState<EntryBottomSheet> createState() => _EntryBottomSheetState();
}

class _EntryBottomSheetState extends ConsumerState<EntryBottomSheet> {
  MaterialItem? _material;
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final _note = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    _cost.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final m = await pickMaterial(context);
    if (m != null) {
      setState(() {
        _material = m;
        if (_cost.text.isEmpty && m.costPrice != null) {
          _cost.text = m.costPrice!.toStringAsFixed(2);
        }
      });
    }
  }

  Future<void> _submit() async {
    final qty = num.tryParse(_qty.text.replaceAll(',', '.'));
    final cost = num.tryParse(_cost.text.replaceAll(',', '.'));
    if (_material == null) {
      setState(() => _error = 'Selecione um material');
      return;
    }
    if (qty == null || qty <= 0) {
      setState(() => _error = 'Quantidade inválida');
      return;
    }
    if (cost == null || cost < 0) {
      setState(() => _error = 'Custo unitário inválido');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(costCenterActionsProvider).addEntry(
            widget.costCenterId,
            materialId: _material!.id,
            quantity: qty,
            unitCost: cost,
            note: _note.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Entrada de material',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _saving ? null : _pick,
            icon: const Icon(Icons.inventory_2_outlined),
            label: Text(_material?.name ?? 'Selecionar material'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _qty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Quantidade'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _cost,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Custo unitário',
              prefixText: 'R\$ ',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Observação (opcional)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: AppColors.danger)),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Lançar entrada'),
            ),
          ),
        ],
      ),
    );
  }
}

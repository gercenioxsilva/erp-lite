import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';

/// Métodos de pagamento aceitos pelo backend (VALID_METHODS).
const Map<String, String> kPaymentMethods = {
  'pix': 'PIX',
  'bank_transfer': 'Transferência',
  'cash': 'Dinheiro',
  'credit_card': 'Cartão de crédito',
  'debit_card': 'Cartão de débito',
  'boleto': 'Boleto',
  'check': 'Cheque',
  'other': 'Outro',
};

/// Abre um sheet de registro de pagamento e retorna o body pronto para a API
/// (`{ payment_date, amount, payment_method }`) ou null se cancelado.
Future<Map<String, dynamic>?> showPaymentSheet(
  BuildContext context, {
  required num suggestedAmount,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _PaymentSheet(suggestedAmount: suggestedAmount),
  );
}

class _PaymentSheet extends StatefulWidget {
  const _PaymentSheet({required this.suggestedAmount});

  final num suggestedAmount;

  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  late final TextEditingController _amount = TextEditingController(
    text: widget.suggestedAmount > 0
        ? widget.suggestedAmount.toStringAsFixed(2)
        : '',
  );
  String _method = 'pix';
  DateTime _date = DateTime.now();
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _submit() {
    final amount = num.tryParse(_amount.text.replaceAll(',', '.'));
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Informe um valor válido');
      return;
    }
    final iso =
        '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    Navigator.of(context).pop(<String, dynamic>{
      'payment_date': iso,
      'amount': amount,
      'payment_method': _method,
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _date = picked);
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
          const Text('Registrar pagamento',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Valor',
              prefixText: 'R\$ ',
              helperText: widget.suggestedAmount > 0
                  ? 'Em aberto: ${CurrencyFormatter.format(widget.suggestedAmount)}'
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _method,
            decoration: const InputDecoration(labelText: 'Forma de pagamento'),
            items: kPaymentMethods.entries
                .map((e) =>
                    DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _method = v ?? 'pix'),
          ),
          const SizedBox(height: 12),
          InkWell(
            onTap: _pickDate,
            child: InputDecorator(
              decoration: const InputDecoration(labelText: 'Data'),
              child: Text(
                '${_date.day.toString().padLeft(2, '0')}/${_date.month.toString().padLeft(2, '0')}/${_date.year}',
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: AppColors.danger)),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: _submit,
              child: const Text('Confirmar pagamento'),
            ),
          ),
        ],
      ),
    );
  }
}

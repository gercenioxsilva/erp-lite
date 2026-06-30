import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/payment_sheet.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/receivables/receivables_model.dart';
import 'package:orquestra_mobile/features/receivables/receivables_provider.dart';

class ReceivableDetailPage extends ConsumerStatefulWidget {
  const ReceivableDetailPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<ReceivableDetailPage> createState() =>
      _ReceivableDetailPageState();
}

class _ReceivableDetailPageState extends ConsumerState<ReceivableDetailPage> {
  bool _busy = false;

  Future<void> _registerPayment(Receivable r) async {
    final body = await showPaymentSheet(context, suggestedAmount: r.openAmount);
    if (body == null) return;
    await _run(() =>
        ref.read(receivableActionsProvider).registerPayment(r.id, body));
  }

  Future<void> _emitBoleto(Receivable r) async {
    await _run(() => ref.read(receivableActionsProvider).emitBoleto(r.id),
        ok: 'Boleto solicitado');
  }

  Future<void> _run(Future<void> Function() action,
      {String ok = 'Pagamento registrado'}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ok)));
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: AppColors.danger),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(receivableDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Conta a receber')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(receivableDetailProvider(widget.id)),
        ),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(Receivable r) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(r.description,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              StatusBadge(r.status),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      _row('Valor total', CurrencyFormatter.format(r.amount)),
                      _row('Pago', CurrencyFormatter.format(r.paidAmount)),
                      _row('Em aberto', CurrencyFormatter.format(r.openAmount),
                          bold: true),
                      if (r.dueDate != null)
                        _row('Vencimento', DateFormatter.date(r.dueDate)),
                      if (r.clientName != null) _row('Cliente', r.clientName!),
                    ],
                  ),
                ),
              ),
              if (r.boletoLine != null) ...[
                const SizedBox(height: 16),
                Card(
                  child: ListTile(
                    title: const Text('Linha digitável'),
                    subtitle: Text(r.boletoLine!,
                        style: const TextStyle(fontSize: 12)),
                    trailing: IconButton(
                      icon: const Icon(Icons.copy),
                      onPressed: () {
                        Clipboard.setData(
                            ClipboardData(text: r.boletoLine!));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Linha copiada')),
                        );
                      },
                    ),
                  ),
                ),
              ],
              if (r.payments.isNotEmpty) ...[
                const SizedBox(height: 16),
                _buildPayments(r),
              ],
            ],
          ),
        ),
        if (r.isOpen)
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton.icon(
                      onPressed: _busy ? null : () => _registerPayment(r),
                      icon: const Icon(Icons.payments_outlined),
                      label: const Text('Registrar pagamento'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _emitBoleto(r),
                      icon: const Icon(Icons.receipt_outlined),
                      label: const Text('Emitir boleto'),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildPayments(Receivable r) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Pagamentos',
                style: TextStyle(fontWeight: FontWeight.w700)),
            const Divider(),
            ...r.payments.map((p) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(DateFormatter.date(p['payment_date'])),
                      Text(CurrencyFormatter.format(p['amount']),
                          style:
                              const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textMuted)),
          Text(value,
              style: TextStyle(
                fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
                color: bold ? AppColors.success : AppColors.text,
              )),
        ],
      ),
    );
  }
}

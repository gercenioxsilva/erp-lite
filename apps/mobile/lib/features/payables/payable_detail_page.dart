import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/payment_sheet.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/payables/payables_model.dart';
import 'package:orquestra_mobile/features/payables/payables_provider.dart';

class PayableDetailPage extends ConsumerStatefulWidget {
  const PayableDetailPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<PayableDetailPage> createState() => _PayableDetailPageState();
}

class _PayableDetailPageState extends ConsumerState<PayableDetailPage> {
  bool _busy = false;

  Future<void> _registerPayment(Payable p) async {
    final body = await showPaymentSheet(context, suggestedAmount: p.openAmount);
    if (body == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(payableActionsProvider).registerPayment(p.id, body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pagamento registrado')),
        );
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
    final detail = ref.watch(payableDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Conta a pagar')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(payableDetailProvider(widget.id)),
        ),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(Payable p) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(p.description,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Row(
                children: [
                  StatusBadge(p.status),
                  const SizedBox(width: 8),
                  Text(p.categoryLabel,
                      style: const TextStyle(color: AppColors.textMuted)),
                ],
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      _row('Valor total', CurrencyFormatter.format(p.amount)),
                      _row('Pago', CurrencyFormatter.format(p.paidAmount)),
                      _row('Em aberto', CurrencyFormatter.format(p.openAmount),
                          bold: true),
                      if (p.dueDate != null)
                        _row('Vencimento', DateFormatter.date(p.dueDate)),
                      if (p.supplierName != null)
                        _row('Fornecedor', p.supplierName!),
                    ],
                  ),
                ),
              ),
              if (p.payments.isNotEmpty) ...[
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Pagamentos',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        const Divider(),
                        ...p.payments.map((pay) => Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(DateFormatter.date(
                                      pay['payment_date'])),
                                  Text(
                                      CurrencyFormatter.format(pay['amount']),
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600)),
                                ],
                              ),
                            )),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (p.isOpen)
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: _busy ? null : () => _registerPayment(p),
                  icon: const Icon(Icons.payments_outlined),
                  label: const Text('Registrar pagamento'),
                ),
              ),
            ),
          ),
      ],
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
                color: bold ? AppColors.warning : AppColors.text,
              )),
        ],
      ),
    );
  }
}

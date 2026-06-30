import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/orders/orders_model.dart';
import 'package:orquestra_mobile/features/orders/orders_provider.dart';

class OrderDetailPage extends ConsumerStatefulWidget {
  const OrderDetailPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<OrderDetailPage> createState() => _OrderDetailPageState();
}

class _OrderDetailPageState extends ConsumerState<OrderDetailPage> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action, String ok) async {
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
    final detail = ref.watch(orderDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Pedido')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(orderDetailProvider(widget.id)),
        ),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(Order order) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Pedido ${order.number}',
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                  StatusBadge(order.status),
                ],
              ),
              const SizedBox(height: 4),
              Text(order.clientName ?? 'Sem cliente',
                  style: const TextStyle(color: AppColors.textMuted)),
              if (order.createdAt != null)
                Text('Criado em ${DateFormatter.date(order.createdAt)}',
                    style: const TextStyle(
                        color: AppColors.textMuted, fontSize: 12)),
              const SizedBox(height: 16),
              _buildItems(order),
              const SizedBox(height: 16),
              _buildTotals(order),
            ],
          ),
        ),
        if (_buildActions(order) != null)
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _buildActions(order)!,
            ),
          ),
      ],
    );
  }

  Widget _buildItems(Order order) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Itens',
                style: TextStyle(fontWeight: FontWeight.w700)),
            const Divider(),
            ...order.items.map((it) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(it.name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w500)),
                            Text(
                              '${it.quantity} ${it.unit ?? ''} × ${CurrencyFormatter.format(it.unitPrice)}',
                              style: const TextStyle(
                                  fontSize: 12, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      Text(CurrencyFormatter.format(it.total),
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

  Widget _buildTotals(Order order) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            if (order.subtotal != null)
              _totalRow('Subtotal', order.subtotal!),
            if ((order.discount ?? 0) != 0)
              _totalRow('Desconto', -(order.discount ?? 0)),
            if ((order.shipping ?? 0) != 0)
              _totalRow('Frete', order.shipping!),
            const Divider(),
            _totalRow('Total', order.total, bold: true),
          ],
        ),
      ),
    );
  }

  Widget _totalRow(String label, num value, {bool bold = false}) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
      fontSize: bold ? 16 : 14,
      color: bold ? AppColors.primary : AppColors.text,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(CurrencyFormatter.format(value), style: style),
        ],
      ),
    );
  }

  Widget? _buildActions(Order order) {
    final actions = ref.read(orderActionsProvider);
    final buttons = <Widget>[];
    if (order.isDraft) {
      buttons.add(_actionBtn(
          'Confirmar pedido', Icons.check, AppColors.success,
          () => actions.confirm(order.id), 'Pedido confirmado'));
    }
    if (order.isConfirmed) {
      buttons.add(_actionBtn(
          'Marcar como entregue', Icons.local_shipping, AppColors.primary,
          () => actions.deliver(order.id), 'Pedido entregue'));
    }
    if (order.canCancel) {
      buttons.add(_actionBtn(
          'Cancelar pedido', Icons.close, AppColors.danger,
          () => actions.cancel(order.id), 'Pedido cancelado',
          outlined: true));
    }
    if (buttons.isEmpty) return null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final b in buttons) ...[b, const SizedBox(height: 8)],
      ],
    );
  }

  Widget _actionBtn(
    String label,
    IconData icon,
    Color color,
    Future<void> Function() action,
    String okMsg, {
    bool outlined = false,
  }) {
    final onPressed = _busy ? null : () => _run(action, okMsg);
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: outlined
          ? OutlinedButton.icon(
              onPressed: onPressed,
              icon: Icon(icon, color: color),
              label: Text(label, style: TextStyle(color: color)),
              style: OutlinedButton.styleFrom(side: BorderSide(color: color)),
            )
          : ElevatedButton.icon(
              onPressed: onPressed,
              icon: Icon(icon),
              label: Text(label),
              style: ElevatedButton.styleFrom(backgroundColor: color),
            ),
    );
  }
}

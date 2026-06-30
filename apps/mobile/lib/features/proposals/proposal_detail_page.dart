import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/proposals/proposals_model.dart';
import 'package:orquestra_mobile/features/proposals/proposals_provider.dart';

class ProposalDetailPage extends ConsumerStatefulWidget {
  const ProposalDetailPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<ProposalDetailPage> createState() =>
      _ProposalDetailPageState();
}

class _ProposalDetailPageState extends ConsumerState<ProposalDetailPage> {
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
    final detail = ref.watch(proposalDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Proposta')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(proposalDetailProvider(widget.id)),
        ),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(Proposal p) {
    final actions = ref.read(proposalActionsProvider);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      p.title.isEmpty ? 'Proposta ${p.number}' : p.title,
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800),
                    ),
                  ),
                  StatusBadge(p.status),
                ],
              ),
              const SizedBox(height: 4),
              Text(p.clientName ?? 'Sem cliente',
                  style: const TextStyle(color: AppColors.textMuted)),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      _row('Número', p.number),
                      if (p.validUntil != null)
                        _row('Validade', DateFormatter.date(p.validUntil)),
                      if (p.total != null)
                        _row('Total', CurrencyFormatter.format(p.total),
                            bold: true),
                    ],
                  ),
                ),
              ),
              if (p.items.isNotEmpty) ...[
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Itens',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        const Divider(),
                        ...p.items.map((it) => Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Expanded(
                                      child: Text(
                                          it['name']?.toString() ?? 'Item')),
                                  Text(
                                      CurrencyFormatter.format(
                                          it['total'] ?? it['line_total']),
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
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: _buildActions(p, actions),
          ),
        ),
      ],
    );
  }

  Widget _buildActions(Proposal p, ProposalActions actions) {
    final buttons = <Widget>[];
    if (p.canSend) {
      buttons.add(_btn('Enviar proposta', Icons.send, AppColors.primary,
          () => actions.send(p.id), 'Proposta enviada'));
    }
    if (p.canConvert) {
      buttons.add(_btn('Converter em pedido', Icons.swap_horiz,
          AppColors.success, () => actions.convert(p.id), 'Pedido criado'));
    }
    if (p.canCancel) {
      buttons.add(_btn('Cancelar proposta', Icons.close, AppColors.danger,
          () => actions.cancel(p.id), 'Proposta cancelada',
          outlined: true));
    }
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final b in buttons) ...[b, const SizedBox(height: 8)],
      ],
    );
  }

  Widget _btn(String label, IconData icon, Color color,
      Future<void> Function() action, String ok,
      {bool outlined = false}) {
    final onPressed = _busy ? null : () => _run(action, ok);
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
                color: bold ? AppColors.primary : AppColors.text,
              )),
        ],
      ),
    );
  }
}

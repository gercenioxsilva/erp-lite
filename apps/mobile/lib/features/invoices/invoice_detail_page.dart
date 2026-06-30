import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/invoices/invoices_model.dart';
import 'package:orquestra_mobile/features/invoices/invoices_provider.dart';

class InvoiceDetailPage extends ConsumerStatefulWidget {
  const InvoiceDetailPage({super.key, required this.id});

  final String id;

  @override
  ConsumerState<InvoiceDetailPage> createState() => _InvoiceDetailPageState();
}

class _InvoiceDetailPageState extends ConsumerState<InvoiceDetailPage> {
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

  Future<void> _openDanfe(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    // Regra Mobile-11: DANFE abre no browser externo.
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _copyChave(String chave) {
    Clipboard.setData(ClipboardData(text: chave));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Chave copiada')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(invoiceDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Nota Fiscal')),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(invoiceDetailProvider(widget.id)),
        ),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(Invoice inv) {
    final actions = ref.read(invoiceActionsProvider);
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
                    'NF ${inv.number}${inv.serie != null ? '/${inv.serie}' : ''}',
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                  StatusBadge(inv.effectiveStatus),
                ],
              ),
              const SizedBox(height: 4),
              Text(inv.clientName ?? 'Sem cliente',
                  style: const TextStyle(color: AppColors.textMuted)),
              const SizedBox(height: 16),
              if (inv.nfeRejectReason != null)
                Card(
                  color: AppColors.dangerBg,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline,
                            color: AppColors.danger),
                        const SizedBox(width: 8),
                        Expanded(child: Text(inv.nfeRejectReason!)),
                      ],
                    ),
                  ),
                ),
              _buildInfo(inv),
              if (inv.items.isNotEmpty) ...[
                const SizedBox(height: 16),
                _buildItems(inv),
              ],
              if (inv.nfeChave != null) ...[
                const SizedBox(height: 16),
                Card(
                  child: ListTile(
                    title: const Text('Chave de acesso'),
                    subtitle: Text(inv.nfeChave!,
                        style: const TextStyle(fontSize: 12)),
                    trailing: IconButton(
                      icon: const Icon(Icons.copy),
                      onPressed: () => _copyChave(inv.nfeChave!),
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
            child: _buildActions(inv, actions),
          ),
        ),
      ],
    );
  }

  Widget _buildInfo(Invoice inv) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _row('Emissão', DateFormatter.date(inv.issueDate)),
            if (inv.orderNumber != null) _row('Pedido', inv.orderNumber!),
            if (inv.subtotal != null)
              _row('Subtotal', CurrencyFormatter.format(inv.subtotal)),
            _row('Total', CurrencyFormatter.format(inv.total), bold: true),
          ],
        ),
      ),
    );
  }

  Widget _buildItems(Invoice inv) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Itens',
                style: TextStyle(fontWeight: FontWeight.w700)),
            const Divider(),
            ...inv.items.map((it) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                          child: Text(it['name']?.toString() ?? 'Item')),
                      Text(CurrencyFormatter.format(it['total']),
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
                color: bold ? AppColors.primary : AppColors.text,
              )),
        ],
      ),
    );
  }

  Widget _buildActions(Invoice inv, InvoiceActions actions) {
    final buttons = <Widget>[];
    if (inv.hasDanfe) {
      buttons.add(SizedBox(
        width: double.infinity,
        height: 48,
        child: ElevatedButton.icon(
          onPressed: _busy ? null : () => _openDanfe(inv.nfeDanfeUrl!),
          icon: const Icon(Icons.picture_as_pdf),
          label: const Text('Abrir DANFE'),
        ),
      ));
    }
    if (inv.canEmit) {
      buttons.add(SizedBox(
        width: double.infinity,
        height: 48,
        child: ElevatedButton.icon(
          onPressed: _busy
              ? null
              : () => _run(() => actions.emit(inv.id), 'NF-e enviada para emissão'),
          icon: const Icon(Icons.send),
          label: const Text('Emitir NF-e'),
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
        ),
      ));
    }
    if (inv.canCancel) {
      buttons.add(SizedBox(
        width: double.infinity,
        height: 48,
        child: OutlinedButton.icon(
          onPressed: _busy
              ? null
              : () => _run(() => actions.cancel(inv.id), 'Nota cancelada'),
          icon: const Icon(Icons.close, color: AppColors.danger),
          label: const Text('Cancelar nota',
              style: TextStyle(color: AppColors.danger)),
          style: OutlinedButton.styleFrom(
              side: const BorderSide(color: AppColors.danger)),
        ),
      ));
    }
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final b in buttons) ...[b, const SizedBox(height: 8)],
      ],
    );
  }
}

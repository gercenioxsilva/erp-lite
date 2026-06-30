import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/utils/date_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/status_badge.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';
import 'package:orquestra_mobile/features/clients/clients_provider.dart';

class ClientDetailPage extends ConsumerWidget {
  const ClientDetailPage({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(clientDetailProvider(id));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cliente'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => context.push('/clients/$id/edit'),
          ),
        ],
      ),
      body: detail.when(
        loading: () => const LoadingOverlay(),
        error: (err, _) => ErrorCard(
          message: err.toString(),
          onRetry: () => ref.invalidate(clientDetailProvider(id)),
        ),
        data: (client) => _buildContent(context, ref, client),
      ),
    );
  }

  Widget _buildContent(BuildContext context, WidgetRef ref, Client client) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildHeader(client),
        const SizedBox(height: 16),
        _buildInfoCard(client),
        const SizedBox(height: 16),
        Text(
          'Histórico 360°',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: 8),
        _buildHistory(ref),
      ],
    );
  }

  Widget _buildHeader(Client client) {
    return Row(
      children: [
        CircleAvatar(
          radius: 28,
          backgroundColor: AppColors.infoBg,
          child: Icon(
            client.isPJ ? Icons.business : Icons.person,
            color: AppColors.primary,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                client.displayName,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              StatusBadge(client.isActive ? 'active' : 'disabled'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoCard(Client client) {
    final rows = <(String, String?)>[
      ('Tipo', client.isPJ ? 'Pessoa Jurídica' : 'Pessoa Física'),
      (client.isPJ ? 'CNPJ' : 'CPF', client.document),
      ('E-mail', client.email),
      ('Telefone', client.phone ?? client.mobile),
      ('Cidade', client.city),
      ('UF', client.state),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: rows
              .where((r) => (r.$2 ?? '').isNotEmpty)
              .map((r) => _infoRow(r.$1, r.$2!))
              .toList(),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHistory(WidgetRef ref) {
    final history = ref.watch(clientHistoryProvider(id));
    return history.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => ErrorCard(
        message: err.toString(),
        onRetry: () => ref.invalidate(clientHistoryProvider(id)),
      ),
      data: (h) => Column(
        children: [
          _historySection(
            'Pedidos',
            Icons.receipt_long_outlined,
            h.orders,
            (o) => _historyTile(
              title: 'Pedido ${o['number'] ?? ''}',
              subtitle: DateFormatter.date(o['created_at']),
              trailing: CurrencyFormatter.format(o['total']),
              status: o['status']?.toString(),
            ),
          ),
          _historySection(
            'Notas Fiscais',
            Icons.description_outlined,
            h.invoices,
            (i) => _historyTile(
              title: 'NF ${i['number'] ?? ''}',
              subtitle: DateFormatter.date(i['issue_date']),
              trailing: CurrencyFormatter.format(i['total']),
              status: (i['nfe_status'] ?? i['status'])?.toString(),
            ),
          ),
          _historySection(
            'Recebíveis',
            Icons.south_west,
            h.receivables,
            (r) => _historyTile(
              title: r['description']?.toString() ?? 'Recebível',
              subtitle: 'Venc. ${DateFormatter.date(r['due_date'])}',
              trailing: CurrencyFormatter.format(r['amount']),
              status: r['status']?.toString(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _historySection(
    String title,
    IconData icon,
    List<Map<String, dynamic>> items,
    Widget Function(Map<String, dynamic>) tile,
  ) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: AppColors.primary),
                const SizedBox(width: 8),
                Text(
                  '$title (${items.length})',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const Divider(),
            ...items.map(tile),
          ],
        ),
      ),
    );
  }

  Widget _historyTile({
    required String title,
    required String subtitle,
    required String trailing,
    String? status,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(
                  subtitle,
                  style:
                      const TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(trailing,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              if (status != null) ...[
                const SizedBox(height: 2),
                StatusBadge(status),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

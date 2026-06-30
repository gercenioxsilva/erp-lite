import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/utils/currency_formatter.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/features/dashboard/dashboard_model.dart';
import 'package:orquestra_mobile/features/dashboard/dashboard_provider.dart';
import 'package:orquestra_mobile/features/dashboard/kpi_card.dart';

class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(dashboardProvider);
    return state.when(
      loading: () => const LoadingOverlay(),
      error: (err, _) => ErrorCard(
        message: err.toString(),
        onRetry: () => ref.invalidate(dashboardProvider),
      ),
      data: (data) => RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async => ref.invalidate(dashboardProvider),
        child: _buildContent(context, data),
      ),
    );
  }

  Widget _buildContent(BuildContext context, DashboardData data) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildKpiGrid(context, data),
        const SizedBox(height: 24),
        if (data.revenueByMonth.isNotEmpty) _buildRevenueChart(data),
      ],
    );
  }

  Widget _buildKpiGrid(BuildContext context, DashboardData data) {
    final cards = <Widget>[
      KpiCard(
        label: S.pendingReceivables,
        value: CurrencyFormatter.format(data.receivablesPendingAmount),
        caption: '${data.receivablesPendingCount} título(s)',
        icon: Icons.south_west,
        accent: AppColors.success,
      ),
      KpiCard(
        label: S.payablesDueWeek,
        value: CurrencyFormatter.format(data.payablesDueWeekAmount),
        caption: '${data.payablesDueWeekCount} conta(s)',
        icon: Icons.north_east,
        accent: AppColors.warning,
      ),
      KpiCard(
        label: S.revenueThisMonth,
        value: CurrencyFormatter.format(data.revenueThisMonth),
        caption:
            '${S.revenueLastMonth}: ${CurrencyFormatter.format(data.revenueLastMonth)}',
        icon: Icons.trending_up,
        accent: AppColors.primary,
      ),
      KpiCard(
        label: S.overdueReceivables,
        value: CurrencyFormatter.format(data.receivablesOverdueAmount),
        caption: '${data.receivablesOverdueCount} vencido(s)',
        icon: Icons.warning_amber_rounded,
        accent: AppColors.danger,
      ),
      KpiCard(
        label: S.overduePayables,
        value: CurrencyFormatter.format(data.payablesOverdueAmount),
        caption: '${data.payablesOverdueCount} vencido(s)',
        icon: Icons.error_outline,
        accent: AppColors.danger,
      ),
      KpiCard(
        label: S.pendingOrders,
        value: '${data.pendingOrders}',
        caption: 'aguardando entrega',
        icon: Icons.local_shipping_outlined,
        accent: AppColors.accent,
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth > 520 ? 3 : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.45,
          children: cards,
        );
      },
    );
  }

  Widget _buildRevenueChart(DashboardData data) {
    final maxTotal = data.revenueByMonth
        .map((e) => e.total)
        .fold<num>(0, (a, b) => a > b ? a : b);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            S.revenueByMonth,
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 160,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: data.revenueByMonth
                  .map((m) => _buildBar(m, maxTotal))
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBar(MonthlyRevenue m, num maxTotal) {
    final ratio = maxTotal > 0 ? (m.total / maxTotal) : 0.0;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Text(
              _shortValue(m.total),
              style: const TextStyle(fontSize: 9, color: AppColors.textMuted),
            ),
            const SizedBox(height: 4),
            Container(
              height: (120 * ratio).clamp(4, 120).toDouble(),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primary, AppColors.accent],
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                ),
                borderRadius: BorderRadius.circular(6),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _monthLabel(m.month),
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  String _monthLabel(String yyyyMm) {
    final parts = yyyyMm.split('-');
    if (parts.length < 2) return yyyyMm;
    const months = [
      'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
      'jul', 'ago', 'set', 'out', 'nov', 'dez',
    ];
    final idx = (int.tryParse(parts[1]) ?? 1) - 1;
    if (idx < 0 || idx > 11) return yyyyMm;
    return months[idx];
  }

  String _shortValue(num value) {
    if (value >= 1000) return '${(value / 1000).toStringAsFixed(0)}k';
    return value.toStringAsFixed(0);
  }
}

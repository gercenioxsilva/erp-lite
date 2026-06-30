/// Modelo do GET /v1/dashboard (shape confirmado no backend).
class DashboardData {
  const DashboardData({
    required this.receivablesPendingAmount,
    required this.receivablesPendingCount,
    required this.receivablesOverdueAmount,
    required this.receivablesOverdueCount,
    required this.payablesDueWeekAmount,
    required this.payablesDueWeekCount,
    required this.payablesOverdueAmount,
    required this.payablesOverdueCount,
    required this.revenueThisMonth,
    required this.revenueLastMonth,
    required this.pendingOrders,
    required this.revenueByMonth,
  });

  final num receivablesPendingAmount;
  final int receivablesPendingCount;
  final num receivablesOverdueAmount;
  final int receivablesOverdueCount;
  final num payablesDueWeekAmount;
  final int payablesDueWeekCount;
  final num payablesOverdueAmount;
  final int payablesOverdueCount;
  final num revenueThisMonth;
  final num revenueLastMonth;
  final int pendingOrders;
  final List<MonthlyRevenue> revenueByMonth;

  factory DashboardData.fromJson(Map<String, dynamic> json) {
    final recv = (json['receivables'] as Map<String, dynamic>?) ?? const {};
    final pay = (json['payables'] as Map<String, dynamic>?) ?? const {};
    final rev = (json['revenue'] as Map<String, dynamic>?) ?? const {};
    final orders = (json['orders'] as Map<String, dynamic>?) ?? const {};
    final byMonth = (json['revenue_by_month'] as List<dynamic>?) ?? const [];

    return DashboardData(
      receivablesPendingAmount: _num(recv['pending_amount']),
      receivablesPendingCount: _int(recv['pending_count']),
      receivablesOverdueAmount: _num(recv['overdue_amount']),
      receivablesOverdueCount: _int(recv['overdue_count']),
      payablesDueWeekAmount: _num(pay['due_week_amount']),
      payablesDueWeekCount: _int(pay['due_week_count']),
      payablesOverdueAmount: _num(pay['overdue_amount']),
      payablesOverdueCount: _int(pay['overdue_count']),
      revenueThisMonth: _num(rev['this_month']),
      revenueLastMonth: _num(rev['last_month']),
      pendingOrders: _int(orders['pending_count']),
      revenueByMonth: byMonth
          .map((e) => MonthlyRevenue.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
    );
  }

  static num _num(Object? v) {
    if (v is num) return v;
    if (v is String) return num.tryParse(v) ?? 0;
    return 0;
  }

  static int _int(Object? v) => _num(v).toInt();
}

class MonthlyRevenue {
  const MonthlyRevenue({required this.month, required this.total});

  final String month; // 'YYYY-MM'
  final num total;

  factory MonthlyRevenue.fromJson(Map<String, dynamic> json) => MonthlyRevenue(
        month: json['month']?.toString() ?? '',
        total: DashboardData._num(json['total']),
      );
}

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/features/dashboard/dashboard_model.dart';

/// Carrega os KPIs do painel. AutoDispose para recarregar ao reentrar.
final dashboardProvider = FutureProvider.autoDispose<DashboardData>((ref) async {
  final api = ref.watch(apiClientProvider);
  final data = await api.get(Endpoints.dashboard) as Map<String, dynamic>;
  return DashboardData.fromJson(data);
});

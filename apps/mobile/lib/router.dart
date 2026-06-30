import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/auth/auth_provider.dart';
import 'package:orquestra_mobile/core/widgets/app_scaffold.dart';
import 'package:orquestra_mobile/features/auth/forgot_password_page.dart';
import 'package:orquestra_mobile/features/auth/login_page.dart';
import 'package:orquestra_mobile/features/clients/client_detail_page.dart';
import 'package:orquestra_mobile/features/clients/client_form_page.dart';
import 'package:orquestra_mobile/features/clients/clients_list_page.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_center_detail_page.dart';
import 'package:orquestra_mobile/features/cost_centers/cost_centers_list_page.dart';
import 'package:orquestra_mobile/features/dashboard/dashboard_page.dart';
import 'package:orquestra_mobile/features/invoices/invoice_detail_page.dart';
import 'package:orquestra_mobile/features/invoices/invoices_list_page.dart';
import 'package:orquestra_mobile/features/materials/material_detail_page.dart';
import 'package:orquestra_mobile/features/materials/materials_list_page.dart';
import 'package:orquestra_mobile/features/orders/order_create_page.dart';
import 'package:orquestra_mobile/features/orders/order_detail_page.dart';
import 'package:orquestra_mobile/features/orders/orders_list_page.dart';
import 'package:orquestra_mobile/features/payables/payable_detail_page.dart';
import 'package:orquestra_mobile/features/payables/payables_list_page.dart';
import 'package:orquestra_mobile/features/proposals/proposal_create_page.dart';
import 'package:orquestra_mobile/features/proposals/proposal_detail_page.dart';
import 'package:orquestra_mobile/features/proposals/proposals_list_page.dart';
import 'package:orquestra_mobile/features/receivables/receivable_detail_page.dart';
import 'package:orquestra_mobile/features/receivables/receivables_list_page.dart';
import 'package:orquestra_mobile/features/stock/stock_page.dart';
import 'package:orquestra_mobile/features/suppliers/supplier_detail_page.dart';
import 'package:orquestra_mobile/features/suppliers/suppliers_list_page.dart';

/// Ponte: re-avalia o redirect do GoRouter quando o estado de auth muda.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(this._ref) {
    _ref.listen(authNotifierProvider, (_, __) => notifyListeners());
  }
  final Ref _ref;
}

String _id(GoRouterState s) => s.pathParameters['id']!;

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefreshNotifier(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authNotifierProvider);
      if (auth.isLoading) return null;

      final loggedIn = auth.valueOrNull != null;
      final loc = state.matchedLocation;
      final isAuthRoute = loc == '/login' || loc == '/forgot-password';

      if (!loggedIn && !isAuthRoute) return '/login';
      if (loggedIn && loc == '/login') return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginPage()),
      GoRoute(
        path: '/forgot-password',
        builder: (_, __) => const ForgotPasswordPage(),
      ),

      // Rotas full-screen (push sobre o shell) — têm AppBar própria.
      GoRoute(
          path: '/clients/new', builder: (_, __) => const ClientFormPage()),
      GoRoute(
        path: '/clients/:id/edit',
        builder: (_, s) => ClientFormPage(id: s.pathParameters['id']),
      ),
      GoRoute(
          path: '/clients/:id',
          builder: (_, s) => ClientDetailPage(id: _id(s))),
      GoRoute(
          path: '/materials/:id',
          builder: (_, s) => MaterialDetailPage(id: _id(s))),
      GoRoute(
          path: '/suppliers/:id',
          builder: (_, s) => SupplierDetailPage(id: _id(s))),
      GoRoute(
          path: '/orders/new', builder: (_, __) => const OrderCreatePage()),
      GoRoute(
          path: '/orders/:id',
          builder: (_, s) => OrderDetailPage(id: _id(s))),
      GoRoute(
          path: '/invoices/:id',
          builder: (_, s) => InvoiceDetailPage(id: _id(s))),
      GoRoute(
          path: '/receivables/:id',
          builder: (_, s) => ReceivableDetailPage(id: _id(s))),
      GoRoute(
          path: '/payables/:id',
          builder: (_, s) => PayableDetailPage(id: _id(s))),
      GoRoute(
          path: '/cost-centers/:id',
          builder: (_, s) => CostCenterDetailPage(id: _id(s))),
      GoRoute(
          path: '/proposals/new',
          builder: (_, __) => const ProposalCreatePage()),
      GoRoute(
          path: '/proposals/:id',
          builder: (_, s) => ProposalDetailPage(id: _id(s))),

      // Shell com bottom nav + drawer.
      ShellRoute(
        builder: (context, state, child) => AppScaffold(
          location: state.matchedLocation,
          child: child,
        ),
        routes: [
          GoRoute(
              path: '/dashboard', builder: (_, __) => const DashboardPage()),
          GoRoute(
              path: '/clients', builder: (_, __) => const ClientsListPage()),
          GoRoute(
              path: '/materials',
              builder: (_, __) => const MaterialsListPage()),
          GoRoute(path: '/stock', builder: (_, __) => const StockPage()),
          GoRoute(
              path: '/suppliers',
              builder: (_, __) => const SuppliersListPage()),
          GoRoute(
              path: '/orders', builder: (_, __) => const OrdersListPage()),
          GoRoute(
              path: '/invoices',
              builder: (_, __) => const InvoicesListPage()),
          GoRoute(
              path: '/receivables',
              builder: (_, __) => const ReceivablesListPage()),
          GoRoute(
              path: '/payables',
              builder: (_, __) => const PayablesListPage()),
          GoRoute(
              path: '/cost-centers',
              builder: (_, __) => const CostCentersListPage()),
          GoRoute(
              path: '/proposals',
              builder: (_, __) => const ProposalsListPage()),
        ],
      ),
    ],
  );
});

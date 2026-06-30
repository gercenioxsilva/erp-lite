import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/auth/auth_provider.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/orquestra_logo.dart';

/// Entrada de navegação de um módulo.
class NavEntry {
  const NavEntry({
    required this.label,
    required this.route,
    required this.icon,
  });

  final String label;
  final String route;
  final IconData icon;
}

/// Todos os módulos do app (Drawer completo).
const List<NavEntry> kAllModules = [
  NavEntry(label: S.dashboard, route: '/dashboard', icon: Icons.dashboard_outlined),
  NavEntry(label: S.clients, route: '/clients', icon: Icons.people_outline),
  NavEntry(label: S.materials, route: '/materials', icon: Icons.inventory_2_outlined),
  NavEntry(label: S.stock, route: '/stock', icon: Icons.warehouse_outlined),
  NavEntry(label: S.orders, route: '/orders', icon: Icons.receipt_long_outlined),
  NavEntry(label: S.invoices, route: '/invoices', icon: Icons.description_outlined),
  NavEntry(label: S.receivables, route: '/receivables', icon: Icons.south_west),
  NavEntry(label: S.payables, route: '/payables', icon: Icons.north_east),
  NavEntry(label: S.costCenters, route: '/cost-centers', icon: Icons.account_tree_outlined),
  NavEntry(label: S.proposals, route: '/proposals', icon: Icons.handshake_outlined),
  NavEntry(label: S.suppliers, route: '/suppliers', icon: Icons.local_shipping_outlined),
];

/// Destinos primários da bottom bar (4 + "Mais").
const List<NavEntry> kPrimaryNav = [
  NavEntry(label: S.dashboard, route: '/dashboard', icon: Icons.dashboard_outlined),
  NavEntry(label: S.clients, route: '/clients', icon: Icons.people_outline),
  NavEntry(label: S.orders, route: '/orders', icon: Icons.receipt_long_outlined),
  NavEntry(label: S.receivables, route: '/receivables', icon: Icons.south_west),
];

/// Shell padrão: AppBar + Drawer (todos os módulos) + BottomNavigationBar.
class AppScaffold extends ConsumerWidget {
  const AppScaffold({super.key, required this.child, required this.location});

  final Widget child;
  final String location;

  String get _title {
    final match = kAllModules.where((m) => location.startsWith(m.route));
    return match.isNotEmpty ? match.first.label : S.appName;
  }

  int get _currentIndex {
    final idx = kPrimaryNav.indexWhere((n) => location.startsWith(n.route));
    return idx < 0 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_title),
        actions: [
          IconButton(
            tooltip: S.logout,
            icon: const Icon(Icons.logout),
            onPressed: () => _confirmLogout(context, ref),
          ),
        ],
      ),
      drawer: _buildDrawer(context),
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (i) => context.go(kPrimaryNav[i].route),
        destinations: kPrimaryNav
            .map((n) => NavigationDestination(
                  icon: Icon(n.icon),
                  label: n.label,
                ))
            .toList(),
      ),
    );
  }

  Widget _buildDrawer(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.all(20),
              child: OrquestraLogo(size: 40),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: kAllModules.map((m) {
                  final selected = location.startsWith(m.route);
                  return ListTile(
                    leading: Icon(
                      m.icon,
                      color: selected ? AppColors.primary : AppColors.textMuted,
                    ),
                    title: Text(m.label),
                    selected: selected,
                    selectedTileColor: AppColors.infoBg,
                    onTap: () {
                      Navigator.of(context).pop();
                      context.go(m.route);
                    },
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(S.logout),
        content: const Text('Deseja sair da sua conta?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text(S.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text(S.logout),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref.read(authNotifierProvider.notifier).logout();
    }
  }
}

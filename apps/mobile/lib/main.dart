import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_theme.dart';
import 'package:orquestra_mobile/router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Inicializa dados de locale pt-BR para intl (datas/moeda).
  await initializeDateFormatting('pt_BR');
  runApp(const ProviderScope(child: OrquestraApp()));
}

class OrquestraApp extends ConsumerWidget {
  const OrquestraApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: S.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}

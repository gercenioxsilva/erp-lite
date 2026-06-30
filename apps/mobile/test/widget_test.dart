import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/features/auth/login_page.dart';

void main() {
  testWidgets('LoginPage renderiza campos e botão de entrar', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginPage()),
      ),
    );
    await tester.pump();

    expect(find.text(S.welcomeBack), findsOneWidget);
    expect(find.text(S.email), findsOneWidget);
    expect(find.text(S.password), findsOneWidget);
    // O botão de submit existe (mostra spinner durante o bootstrap inicial).
    expect(find.byType(ElevatedButton), findsOneWidget);
    expect(find.text(S.forgotPassword), findsOneWidget);
  });
}

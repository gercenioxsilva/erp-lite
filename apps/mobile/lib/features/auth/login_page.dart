import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/auth/auth_provider.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/orquestra_logo.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    await ref.read(authNotifierProvider.notifier).login(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
        );
  }

  String? _validateEmail(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return S.emailRequired;
    if (!v.contains('@') || !v.contains('.')) return S.emailInvalid;
    return null;
  }

  String? _validatePassword(String? value) {
    if ((value ?? '').isEmpty) return S.passwordRequired;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final isLoading = authState.isLoading;
    final errorMessage = _errorMessage(authState);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Center(child: OrquestraLogo(size: 56)),
                    const SizedBox(height: 40),
                    const Text(
                      S.welcomeBack,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      S.signInToContinue,
                      style: TextStyle(color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      enabled: !isLoading,
                      decoration: const InputDecoration(
                        labelText: S.email,
                        prefixIcon: Icon(Icons.alternate_email),
                      ),
                      validator: _validateEmail,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordCtrl,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      enabled: !isLoading,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: S.password,
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscure
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                          onPressed: () =>
                              setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: _validatePassword,
                    ),
                    if (errorMessage != null) ...[
                      const SizedBox(height: 16),
                      _ErrorBanner(message: errorMessage),
                    ],
                    const SizedBox(height: 24),
                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: isLoading ? null : _submit,
                        child: isLoading
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(S.login),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: isLoading
                          ? null
                          : () => context.push('/forgot-password'),
                      child: const Text(S.forgotPassword),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  String? _errorMessage(AsyncValue<Object?> state) {
    final error = state.error;
    if (error == null) return null;
    if (error is AuthException) return S.invalidCredentials;
    if (error is ApiException) return error.message;
    return S.errorGeneric;
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.dangerBg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.danger, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/providers.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

class ForgotPasswordPage extends ConsumerStatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  ConsumerState<ForgotPasswordPage> createState() =>
      _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends ConsumerState<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  bool _sending = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .forgotPassword(_emailCtrl.text.trim());
      if (mounted) setState(() => _sent = true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(S.forgotPasswordTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent ? _buildSuccess(context) : _buildForm(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            S.forgotPasswordHelp,
            style: TextStyle(color: AppColors.textMuted, fontSize: 15),
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            enabled: !_sending,
            decoration: const InputDecoration(
              labelText: S.email,
              prefixIcon: Icon(Icons.alternate_email),
            ),
            validator: (v) {
              final value = v?.trim() ?? '';
              if (value.isEmpty) return S.emailRequired;
              if (!value.contains('@')) return S.emailInvalid;
              return null;
            },
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: const TextStyle(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _sending ? null : _submit,
              child: _sending
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text(S.sendResetLink),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuccess(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.mark_email_read_outlined,
            size: 64, color: AppColors.success),
        const SizedBox(height: 20),
        const Text(
          S.resetLinkSent,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 16, color: AppColors.text),
        ),
        const SizedBox(height: 28),
        SizedBox(
          height: 52,
          width: double.infinity,
          child: ElevatedButton(
            onPressed: () => context.go('/login'),
            child: const Text(S.login),
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/features/clients/clients_model.dart';
import 'package:orquestra_mobile/features/clients/clients_provider.dart';

/// Formulário de criação/edição de cliente. [id] nulo = criação.
class ClientFormPage extends ConsumerStatefulWidget {
  const ClientFormPage({super.key, this.id});

  final String? id;

  @override
  ConsumerState<ClientFormPage> createState() => _ClientFormPageState();
}

class _ClientFormPageState extends ConsumerState<ClientFormPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _document = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();

  String _personType = 'PJ';
  bool _saving = false;
  bool _loadedForEdit = false;

  bool get _isEdit => widget.id != null;

  @override
  void dispose() {
    _name.dispose();
    _document.dispose();
    _email.dispose();
    _phone.dispose();
    _city.dispose();
    _state.dispose();
    super.dispose();
  }

  void _fillFrom(Client c) {
    if (_loadedForEdit) return;
    _loadedForEdit = true;
    _personType = c.personType;
    _name.text = c.displayName == 'Sem nome' ? '' : c.displayName;
    _document.text = c.document;
    _email.text = c.email ?? '';
    _phone.text = c.phone ?? c.mobile ?? '';
    _city.text = c.city ?? '';
    _state.text = c.state ?? '';
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() => _saving = true);

    final body = <String, dynamic>{
      'person_type': _personType,
      if (_personType == 'PJ') 'company_name': _name.text.trim(),
      if (_personType == 'PF') 'full_name': _name.text.trim(),
      if (_document.text.trim().isNotEmpty)
        (_personType == 'PJ' ? 'cnpj' : 'cpf'): _document.text.trim(),
      if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
      if (_phone.text.trim().isNotEmpty) 'phone': _phone.text.trim(),
      if (_city.text.trim().isNotEmpty) 'city': _city.text.trim(),
      if (_state.text.trim().isNotEmpty) 'state': _state.text.trim().toUpperCase(),
    };

    final notifier = ref.read(clientsProvider.notifier);
    try {
      if (_isEdit) {
        await notifier.update(widget.id!, body);
      } else {
        await notifier.create(body);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cliente salvo com sucesso')),
        );
        context.pop();
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.message),
            backgroundColor: AppColors.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isEdit && !_loadedForEdit) {
      final detail = ref.watch(clientDetailProvider(widget.id!));
      return Scaffold(
        appBar: AppBar(title: const Text('Editar cliente')),
        body: detail.when(
          loading: () => const LoadingOverlay(),
          error: (err, _) => Center(child: Text(err.toString())),
          data: (c) {
            _fillFrom(c);
            return _buildForm();
          },
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Editar cliente' : 'Novo cliente')),
      body: _buildForm(),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'PJ', label: Text('Pessoa Jurídica')),
              ButtonSegment(value: 'PF', label: Text('Pessoa Física')),
            ],
            selected: {_personType},
            onSelectionChanged: _saving
                ? null
                : (s) => setState(() => _personType = s.first),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _name,
            enabled: !_saving,
            decoration: InputDecoration(
              labelText: _personType == 'PJ' ? 'Razão social' : 'Nome completo',
            ),
            validator: (v) =>
                (v ?? '').trim().isEmpty ? 'Informe o nome' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _document,
            enabled: !_saving,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: _personType == 'PJ' ? 'CNPJ' : 'CPF',
            ),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _email,
            enabled: !_saving,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'E-mail'),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _phone,
            enabled: !_saving,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Telefone'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextFormField(
                  controller: _city,
                  enabled: !_saving,
                  decoration: const InputDecoration(labelText: 'Cidade'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextFormField(
                  controller: _state,
                  enabled: !_saving,
                  maxLength: 2,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'UF',
                    counterText: '',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _saving ? null : _submit,
              child: _saving
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Salvar'),
            ),
          ),
        ],
      ),
    );
  }
}

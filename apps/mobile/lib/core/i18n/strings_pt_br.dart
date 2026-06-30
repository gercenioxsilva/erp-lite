/// Strings em pt-BR do app (espelha as chaves do backoffice web).
/// Centralizadas aqui para facilitar futura internacionalização.
abstract final class S {
  const S._();

  // Geral
  static const String appName = 'Orquestra ERP';
  static const String retry = 'Tentar novamente';
  static const String loading = 'Carregando…';
  static const String save = 'Salvar';
  static const String cancel = 'Cancelar';
  static const String confirm = 'Confirmar';
  static const String search = 'Buscar';
  static const String all = 'Todos';
  static const String none = '—';
  static const String emptyDefault = 'Nada por aqui ainda';
  static const String errorGeneric = 'Algo deu errado';
  static const String errorNetwork = 'Sem conexão com o servidor';
  static const String errorServer = 'Erro interno — tente novamente';

  // Auth
  static const String login = 'Entrar';
  static const String logout = 'Sair';
  static const String email = 'E-mail';
  static const String password = 'Senha';
  static const String forgotPassword = 'Esqueci minha senha';
  static const String forgotPasswordTitle = 'Recuperar senha';
  static const String forgotPasswordHelp =
      'Informe seu e-mail e enviaremos um link para redefinir a senha.';
  static const String sendResetLink = 'Enviar link';
  static const String resetLinkSent =
      'Se o e-mail existir, enviamos um link de recuperação.';
  static const String invalidCredentials = 'E-mail ou senha inválidos';
  static const String emailRequired = 'Informe o e-mail';
  static const String emailInvalid = 'E-mail inválido';
  static const String passwordRequired = 'Informe a senha';
  static const String welcomeBack = 'Bem-vindo de volta';
  static const String signInToContinue = 'Entre para continuar';

  // Navegação / módulos
  static const String dashboard = 'Painel';
  static const String clients = 'Clientes';
  static const String materials = 'Materiais';
  static const String orders = 'Pedidos';
  static const String invoices = 'Notas Fiscais';
  static const String receivables = 'A Receber';
  static const String payables = 'A Pagar';
  static const String costCenters = 'Centro de Custo';
  static const String proposals = 'Propostas';
  static const String suppliers = 'Fornecedores';
  static const String stock = 'Estoque';
  static const String more = 'Mais';

  // Dashboard
  static const String pendingReceivables = 'A receber (pendente)';
  static const String overdueReceivables = 'Recebíveis vencidos';
  static const String payablesDueWeek = 'A pagar (7 dias)';
  static const String overduePayables = 'A pagar vencidos';
  static const String revenueThisMonth = 'Faturamento do mês';
  static const String revenueLastMonth = 'Mês anterior';
  static const String pendingOrders = 'Pedidos confirmados';
  static const String revenueByMonth = 'Faturamento por mês';
  static const String cashflow = 'Fluxo de caixa (12 semanas)';
  static const String inflow = 'Entradas';
  static const String outflow = 'Saídas';
  static const String netBalance = 'Saldo';
}

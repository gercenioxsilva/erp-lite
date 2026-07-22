// ── Catálogo de permissões (fonte da verdade em código) ─────────────────────
// O que o app "sabe" controlar. As permissões (module:action) são fixas pelo
// código; os VÍNCULOS role→permissão vivem no banco (tabelas roles /
// role_permissions), o que permite perfis customizáveis por tenant sem mudar
// esta lista. Adicionar uma permissão nova = editar este catálogo; o
// syncRbacCatalog() semeia no banco no boot. Espelhado no frontend em
// apps/backoffice/src/rbac/permissions.ts.

export interface PermissionDef {
  key:         string;  // 'clients:create'
  module:      string;  // 'clients'
  action:      string;  // 'create'
  description: string;
}

// Especificação única: módulo → { label, ações }. Tudo o resto é derivado.
const CATALOG_SPEC: Record<string, { label: string; actions: Record<string, string> }> = {
  dashboard:        { label: 'Dashboard',            actions: { view: 'Visualizar o dashboard' } },
  clients:          { label: 'Clientes',             actions: { view: 'Listar/ver clientes', create: 'Criar cliente', edit: 'Editar cliente', delete: 'Excluir cliente', import: 'Importar clientes', export: 'Exportar clientes' } },
  materials:        { label: 'Materiais/Produtos',   actions: { view: 'Listar/ver materiais', create: 'Criar material', edit: 'Editar material', delete: 'Excluir material', import: 'Importar materiais' } },
  stock:            { label: 'Estoque',              actions: { view: 'Ver estoque', adjust: 'Ajustar/movimentar estoque' } },
  suppliers:        { label: 'Fornecedores',         actions: { view: 'Listar/ver fornecedores', create: 'Criar fornecedor', edit: 'Editar fornecedor', delete: 'Excluir fornecedor' } },
  orders:           { label: 'Pedidos',              actions: { view: 'Listar/ver pedidos', create: 'Criar pedido', edit: 'Editar pedido', delete: 'Excluir pedido' } },
  invoices:         { label: 'Notas Fiscais (NF-e)', actions: { view: 'Ver notas', create: 'Criar nota', emit: 'Emitir/transmitir NF-e', cancel: 'Cancelar NF-e', correct: 'Emitir carta de correção (CC-e)' } },
  nfse:             { label: 'NFS-e',                actions: { view: 'Ver NFS-e', create: 'Criar NFS-e', emit: 'Emitir NFS-e', cancel: 'Cancelar NFS-e' } },
  contracts:        { label: 'Contratos',            actions: { view: 'Ver contratos', create: 'Criar contrato', edit: 'Editar contrato', delete: 'Excluir contrato' } },
  proposals:        { label: 'Propostas',            actions: { view: 'Ver propostas', create: 'Criar proposta', edit: 'Editar proposta', delete: 'Excluir proposta', send: 'Enviar/publicar proposta' } },
  receivables:      { label: 'Recebíveis',           actions: { view: 'Ver recebíveis', create: 'Criar recebível', edit: 'Editar recebível', delete: 'Excluir recebível', export: 'Exportar recebíveis' } },
  payables:         { label: 'Pagáveis',             actions: { view: 'Ver pagáveis', create: 'Criar pagável', edit: 'Editar pagável', delete: 'Excluir pagável', export: 'Exportar pagáveis' } },
  cost_centers:     { label: 'Centros de Custo',     actions: { view: 'Ver centros de custo', create: 'Criar centro de custo', edit: 'Editar centro de custo', delete: 'Excluir centro de custo' } },
  payment_plans:    { label: 'Planos de Pagamento',  actions: { view: 'Ver planos de pagamento', create: 'Criar plano de pagamento', edit: 'Editar plano de pagamento', delete: 'Excluir plano de pagamento' } },
  sellers:          { label: 'Vendedores',           actions: { view: 'Ver vendedores', create: 'Criar vendedor', edit: 'Editar vendedor', delete: 'Excluir vendedor' } },
  transportadoras:  { label: 'Transportadoras',       actions: { view: 'Ver transportadoras', create: 'Criar transportadora', edit: 'Editar transportadora', delete: 'Excluir transportadora' } },
  purchase_orders:  { label: 'Ordens de Compra',     actions: { view: 'Ver ordens de compra', create: 'Criar ordem de compra', edit: 'Editar ordem de compra', delete: 'Excluir ordem de compra' } },
  supplier_invoices:{ label: 'Faturas de Fornecedor',actions: { view: 'Ver faturas', create: 'Criar fatura', edit: 'Editar fatura', delete: 'Excluir fatura' } },
  company:          { label: 'Empresa',              actions: { view: 'Ver dados da empresa', edit: 'Editar dados da empresa' } },
  bank_accounts:    { label: 'Contas Bancárias',     actions: { view: 'Ver contas', manage: 'Gerenciar contas bancárias' } },
  users:            { label: 'Usuários',             actions: { view: 'Listar/ver usuários', create: 'Criar usuário', edit: 'Editar usuário', delete: 'Excluir usuário' } },
  pos:              { label: 'PDV',                  actions: { view: 'Ver PDV', operate: 'Operar caixa/venda', manage: 'Gerenciar terminais/sessões' } },
  service_orders:   { label: 'Ordens de Serviço',    actions: { view: 'Ver OS', create: 'Criar OS', edit: 'Editar OS', delete: 'Excluir OS', assign: 'Atribuir técnico/visita' } },
  projects:         { label: 'Projetos',              actions: { view: 'Ver projetos', create: 'Criar projeto', edit: 'Editar/gerenciar projeto (profissionais, vínculos, status)', delete: 'Excluir projeto' } },
  technicians:      { label: 'Técnicos',             actions: { view: 'Ver técnicos', create: 'Criar técnico', edit: 'Editar técnico', delete: 'Excluir técnico' } },
  // Campos personalizados de Visita Técnica — recurso próprio (não reaproveita
  // service_orders:edit) porque precisa ficar restrito a administradores do
  // tenant (owner + admin, via ALL_PERMISSION_KEYS em roleMatrix.ts), nunca a
  // quem só despacha visitas no dia a dia (manager/user têm service_orders:edit
  // mas não ganham este). Preencher os VALORES continua sob service_orders:assign
  // (backoffice) / portal:access (técnico) — só a CONFIGURAÇÃO do schema é admin-only.
  service_visit_fields: { label: 'Campos Personalizados de Visita', actions: { view: 'Ver campos personalizados de visita', manage: 'Criar/editar/remover campos personalizados de visita' } },
  reports:          { label: 'Relatórios',           actions: { view: 'Ver relatórios', export: 'Exportar relatórios' } },
  billing:          { label: 'Assinatura/Cobrança',  actions: { view: 'Ver cobrança', manage: 'Gerenciar assinatura/plano' } },
  tenant_modules:   { label: 'Módulos',              actions: { view: 'Ver módulos', manage: 'Habilitar/desabilitar módulos' } },
  tax:              { label: 'Impostos',             actions: { view: 'Ver regras fiscais', manage: 'Gerenciar regras fiscais' } },
  marketplace:      { label: 'Marketplace',          actions: { view: 'Ver integração', manage: 'Gerenciar integração de marketplace' } },
  roles:            { label: 'Perfis de Acesso',     actions: { view: 'Ver perfis e permissões', manage: 'Criar/editar perfis e permissões' } },
  portal:           { label: 'Portal do Técnico',    actions: { access: 'Acessar o portal de visitas' } },
  // Agendamento de Sessões com Pacotes (módulo opcional 'scheduling').
  // 'manage_all' distingue dono/admin (todas as agendas) do papel
  // 'professional' (só a própria agenda — escopo aplicado na camada de serviço).
  scheduling:               { label: 'Agendamentos',        actions: { view: 'Ver agenda e sessões', manage: 'Criar/editar/cancelar sessões e disponibilidade', complete: 'Concluir sessão (debita pacote)', manage_all: 'Gerenciar agendas de todos os profissionais', settings: 'Configurações de agendamento' } },
  scheduling_areas:         { label: 'Áreas de Atuação',    actions: { view: 'Ver áreas', create: 'Criar área', edit: 'Editar área', delete: 'Excluir área' } },
  scheduling_professionals: { label: 'Profissionais',       actions: { view: 'Ver profissionais', create: 'Criar profissional', edit: 'Editar profissional', delete: 'Desativar profissional' } },
  scheduling_packages:      { label: 'Pacotes de Sessões',  actions: { view: 'Ver pacotes e modelos', manage: 'Criar/editar modelos e pacotes', grant: 'Conceder pacote a cliente', payment: 'Alterar status de pagamento' } },
  scheduling_portal:        { label: 'Portal do Cliente',   actions: { access: 'Acessar o portal de agendamentos' } },
  // RH Simplificado (módulo opcional 'hr', mergeado de develop) — dados
  // sensíveis de folha: fora do OPERATIONAL do gestor por padrão; owner/admin
  // têm tudo por código e papéis custom podem receber o grant.
  employees:                { label: 'Funcionários (RH)',   actions: { view: 'Ver funcionários', manage: 'Gerenciar funcionários' } },
  payroll:                  { label: 'Folha de Pagamento',  actions: { view: 'Ver folha', manage: 'Calcular/gerenciar folha' } },
  // WhatsApp — Cobranças e Notificações (módulo opcional pago 'whatsapp').
  whatsapp: { label: 'WhatsApp', actions: { view: 'Ver conta, automações e mensagens', manage: 'Conectar conta e configurar automações' } },
  // Gestão Fiscal — Simples Nacional (módulo opcional 'fiscal'). Um módulo
  // único com todas as ações do pipeline importar→conciliar→consolidar→
  // apurar→emitir; 'manage_certificate' fica fora do Gestor (certificado A1
  // é a identidade digital da empresa — mesma trava de bank_accounts:manage).
  fiscal: {
    label: 'Gestão Fiscal',
    actions: {
      view:               'Ver dados fiscais (importações, conciliação, notas, apuração)',
      import:             'Importar vendas (OFX/CSV/Excel)',
      reconcile:          'Conciliar vendas e pagamentos',
      consolidate:        'Configurar regras e consolidar vendas em notas',
      config:             'Configurar cadastro fiscal da empresa (CNAE, Simples, provedor NFS-e)',
      manage_certificate: 'Enviar/remover certificado digital A1',
      apurar:             'Apurar Simples Nacional (PGDAS-D)',
      transmit:           'Transmitir PGDAS-D e gerar DAS na Receita (ato irreversível, com custo)',
      acknowledge:        'Reconhecer/resolver alertas fiscais',
      close:              'Fechar competência (checklist + trava)',
      reopen:             'Reabrir competência travada',
      emit:               'Emitir NFS-e consolidada',
      cancel:             'Cancelar NFS-e emitida',
      substitute:         'Substituir NFS-e emitida',
    },
  },
  // Fiscal Engine API (0080) — chaves de API para consumidores externos do
  // motor de cálculo (/v1/engine/*). Fora do Gestor: chave de API é
  // credencial de LONGA duração (mesma trava de bank_accounts:manage).
  engine: {
    label: 'API do Motor Fiscal',
    actions: { manage: 'Criar, listar e revogar chaves de API do motor fiscal' },
  },
  // Captação de Leads (0084) — chaves de API PUBLICÁVEIS (embutíveis em JS de
  // landing page) que só criam registro em `clients` (origin='landing_page').
  // Fora do Gestor: chave de API é credencial de longa duração (mesma trava
  // de bank_accounts:manage/engine:manage) — ver a criação de lead em si é
  // só clients:view/clients:edit, que o Gestor já tem.
  lead_capture: {
    label: 'Captação de Leads',
    actions: { manage: 'Criar, listar e revogar chaves de captação de leads' },
  },
  // Contabilidade automática (módulo opcional 'contabil') — dupla entrada.
  contabil: {
    label: 'Contabilidade',
    actions: {
      view:   'Ver razão, balancete, livros e balanço',
      post:   'Lançamentos manuais e estornos',
      manage: 'Plano de contas e backfill',
    },
  },
};

export const PERMISSION_CATALOG: PermissionDef[] = Object.entries(CATALOG_SPEC).flatMap(
  ([module, spec]) =>
    Object.entries(spec.actions).map(([action, description]) => ({
      key: `${module}:${action}`,
      module,
      action,
      description,
    })),
);

export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CATALOG_SPEC).map(([module, spec]) => [module, spec.label]),
);

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

// Tipo "solto" de propósito: a validação real é contra ALL_PERMISSION_KEYS.
export type Permission = string;

export function isPermissionKey(key: string): boolean {
  return PERMISSION_KEY_SET.has(key);
}

/** Todas as chaves de um módulo (ex.: modulePermissions('clients')). */
export function modulePermissions(module: string): string[] {
  return PERMISSION_CATALOG.filter((p) => p.module === module).map((p) => p.key);
}

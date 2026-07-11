// ── Papéis de sistema (semente) ─────────────────────────────────────────────
// Os 5 papéis já existentes viram "system roles" (tenant_id NULL) semeados no
// banco pelo syncRbacCatalog(). São imutáveis por código (o admin cria papéis
// CUSTOM por tenant para variações). Esta matriz é o PONTO DE PARTIDA — o
// usuário pode ajustar os grants dos papéis custom pela tela de perfis.
//
// Segurança: 'owner' NÃO depende desta matriz em runtime — o permissionService
// concede TODAS as permissões ao owner por código, para o dono do tenant nunca
// ficar travado por uma falha de seed.

import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from './permissions';

export interface SystemRoleDef {
  key:         string;
  name:        string;
  description: string;
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: 'owner',      name: 'Super Administrador', description: 'Acesso total, incluindo cobrança e perfis de acesso.' },
  { key: 'admin',      name: 'Administrador',       description: 'Acesso total exceto gestão de cobrança.' },
  { key: 'manager',    name: 'Gestor',              description: 'Operação completa (comercial, estoque, financeiro, campo, relatórios). Sem administração.' },
  { key: 'user',       name: 'Operador',            description: 'Operação do dia a dia: ver, criar e editar. Sem exclusões nem administração.' },
  { key: 'technician', name: 'Técnico',             description: 'Somente o portal de visitas em campo.' },
  { key: 'professional', name: 'Profissional',      description: 'Agenda própria, disponibilidade, clientes e conclusão de sessões.' },
  { key: 'client',     name: 'Cliente',             description: 'Somente o portal de agendamentos.' },
];

// Helpers de composição sobre o catálogo.
const keysOf = (modules: string[]): string[] =>
  PERMISSION_CATALOG.filter((p) => modules.includes(p.module)).map((p) => p.key);

const keysOfActions = (modules: string[], actions: string[]): string[] =>
  PERMISSION_CATALOG.filter((p) => modules.includes(p.module) && actions.includes(p.action)).map((p) => p.key);

// Módulos operacionais (dia a dia do negócio, sem administração).
const OPERATIONAL = [
  'clients', 'materials', 'stock', 'suppliers', 'orders', 'invoices', 'nfse',
  'contracts', 'proposals', 'receivables', 'payables', 'cost_centers', 'sellers',
  'purchase_orders', 'supplier_invoices', 'pos', 'service_orders', 'technicians',
  'scheduling', 'scheduling_areas', 'scheduling_professionals', 'scheduling_packages',
];

// Subconjunto do dia a dia para o Operador (escrita leve, sem excluir).
const OPERATOR_MODULES = [
  'clients', 'orders', 'proposals', 'invoices', 'materials', 'stock',
  'receivables', 'payables', 'pos', 'service_orders',
];

const OWNER = ALL_PERMISSION_KEYS;

const ADMIN = ALL_PERMISSION_KEYS.filter((k) => k !== 'billing:manage');

const MANAGER = Array.from(new Set([
  'dashboard:view',
  ...keysOf(OPERATIONAL),           // tudo nos módulos operacionais
  ...keysOf(['reports']),           // relatórios: ver + exportar
  'company:view',
  'bank_accounts:view',
  'billing:view',
  'tax:view',
  'marketplace:view',
  // Mesmo racional de bank_accounts:view — ver conta/automações/mensagens é
  // operacional, mas conectar credenciais (whatsapp:manage) fica só com
  // owner/admin (mesma trava de bank_accounts:manage).
  'whatsapp:view',
// Configuração do agendamento (fuso, antecedência, auto-agendamento) é
// decisão do dono/admin, não operação — gestor fica de fora.
])).filter((k) => k !== 'scheduling:settings');

const USER = Array.from(new Set([
  'dashboard:view',
  'reports:view',
  ...keysOfActions(OPERATOR_MODULES, ['view', 'create', 'edit']),
  'proposals:send',
  'pos:operate',
  // Leituras de referência usadas em vários fluxos (banner de trial, cabeçalho
  // da empresa em propostas/notas) — benignas, evitam 403 em telas do operador.
  'company:view',
  'billing:view',
]));

const TECHNICIAN = ['portal:access'];

// Profissional agendável (módulo scheduling): opera a própria agenda —
// o RBAC dá as ações; o recorte "só a própria agenda" (sem manage_all)
// é aplicado na camada de serviço via scheduling_professionals.user_id.
// company:view/billing:view são as mesmas leituras benignas do Operador.
const PROFESSIONAL = [
  'scheduling:view', 'scheduling:manage', 'scheduling:complete',
  'scheduling_areas:view', 'scheduling_professionals:view', 'scheduling_packages:view',
  'clients:view', 'clients:create', 'clients:edit',
  'company:view', 'billing:view',
];

// Cliente/aluno: somente o portal (/v1/portal/*, reforçado pelo
// clientRoleGuard global — mesma dupla proteção do papel technician).
const CLIENT = ['scheduling_portal:access'];

export const SYSTEM_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner:        OWNER,
  admin:        ADMIN,
  manager:      MANAGER,
  user:         USER,
  technician:   TECHNICIAN,
  professional: PROFESSIONAL,
  client:       CLIENT,
};

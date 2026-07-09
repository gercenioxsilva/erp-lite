// Domínio de Controle de Perfil de Acesso (RBAC) — regras de negócio puras,
// sem I/O. Segue o mesmo padrão de Clean Architecture já usado em
// salesPipelineDomain.ts/simplesRemessaDomain.ts.
//
// role continua existindo em `users`, mas com semântica reduzida a 2 papéis
// de sistema, não-configuráveis: 'owner' (acesso total, nunca bloqueável) e
// 'technician' (portal separado, já isolado por technicianRoleGuard — nunca
// usa perfil). Todo o resto é 'user' + access_profile_id.

export class AccessControlDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'AccessControlDomainError';
  }
}

// ── Recursos e ações — catálogo em código, não em tabela ──────────────────────
// Mesmo racional de MODULE_KEYS (tenantModuleService.ts): adicionar um
// recurso novo nunca deveria exigir migration, só atualizar esta lista.

export const PERMISSION_RESOURCES = [
  'clients', 'materials', 'stock', 'orders', 'invoices', 'nfse', 'simples_remessa',
  'receivables', 'payables', 'cost_centers', 'sellers', 'purchase_orders',
  'supplier_invoices', 'dre', 'reports', 'contracts', 'suppliers', 'proposals',
  'sales_pipeline', 'service_orders', 'technicians', 'pos', 'users', 'company', 'billing',
  'employees', 'payroll',
] as const;

export type PermissionResource = typeof PERMISSION_RESOURCES[number];

export const PERMISSION_ACTIONS = ['view', 'manage'] as const;
export type PermissionAction = typeof PERMISSION_ACTIONS[number];

export function isPermissionResource(value: string): value is PermissionResource {
  return (PERMISSION_RESOURCES as readonly string[]).includes(value);
}

export function isPermissionAction(value: string): value is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

// ── Papéis de sistema — nunca usam perfil ──────────────────────────────────────

export const SYSTEM_ROLES = ['owner', 'technician'] as const;

export function usesAccessProfile(role: string): boolean {
  return !(SYSTEM_ROLES as readonly string[]).includes(role);
}

// ── Guardas de autorização ──────────────────────────────────────────────────

export function assertActorIsOwner(actorRole: string | undefined): void {
  if (actorRole !== 'owner') {
    throw new AccessControlDomainError('actor_not_owner');
  }
}

// Nenhuma rota de perfil/usuário pode setar role='owner' — o papel é fixado
// uma única vez, no registro do tenant (routes/auth.ts#register).
export function assertNotOwnerRole(role: string | undefined): void {
  if (role === 'owner') {
    throw new AccessControlDomainError('cannot_assign_owner_role');
  }
}

// owner/technician têm acesso 100% definido por `role` — atribuir um perfil
// a eles não faz sentido (seria um estado sem efeito, mas confuso na UI).
export function assertCanAssignAccessProfile(targetRole: string): void {
  if (!usesAccessProfile(targetRole)) {
    throw new AccessControlDomainError('role_does_not_use_profile', { role: targetRole });
  }
}

export function validateProfileName(name: string): void {
  if (!name?.trim()) {
    throw new AccessControlDomainError('profile_name_required');
  }
}

// Perfil com usuário ainda vinculado não pode ser excluído — evita deixar
// alguém sem perfil por acidente (usuário ficaria sem nenhum acesso).
export function assertProfileDeletable(usersCount: number): void {
  if (usersCount > 0) {
    throw new AccessControlDomainError('profile_in_use', { usersCount });
  }
}

// ── Permissões efetivas (função pura) ──────────────────────────────────────────

export interface PermissionGrant {
  resource: string;
  action:   PermissionAction;
}

export interface EffectivePermissions {
  can(resource: string, action: PermissionAction): boolean;
}

// owner faz bypass total (nunca pode ficar trancado fora do próprio tenant
// por má configuração de perfil — nem tem perfil, na verdade). Para os
// demais, 'manage' sempre implica 'view' — não faz sentido exigir os dois
// grants separados pra cada recurso.
export function resolveEffectivePermissions(role: string, grants: PermissionGrant[]): EffectivePermissions {
  if (role === 'owner') {
    return { can: () => true };
  }
  const granted = new Set(grants.map(g => `${g.resource}:${g.action}`));
  return {
    can(resource, action) {
      if (action === 'view' && granted.has(`${resource}:manage`)) return true;
      return granted.has(`${resource}:${action}`);
    },
  };
}

export function permissionsToMap(effective: EffectivePermissions): Record<string, { view: boolean; manage: boolean }> {
  const map: Record<string, { view: boolean; manage: boolean }> = {};
  for (const resource of PERMISSION_RESOURCES) {
    map[resource] = { view: effective.can(resource, 'view'), manage: effective.can(resource, 'manage') };
  }
  return map;
}

// ── Perfis padrão (lazy-seed, mesmo idioma de DEFAULT_STAGES) ─────────────────
// Semeados automaticamente na primeira leitura de um tenant sem nenhum
// perfil — só um ponto de partida editável, nunca fixo.

export interface DefaultProfileTemplate {
  name:        string;
  description: string;
  grants:      PermissionGrant[];
}

const ALL_VIEW: PermissionGrant[]   = PERMISSION_RESOURCES.map(resource => ({ resource, action: 'view' as const }));
const ALL_MANAGE: PermissionGrant[] = PERMISSION_RESOURCES.map(resource => ({ resource, action: 'manage' as const }));

const FINANCE_MANAGE_RESOURCES: PermissionResource[]     = ['receivables', 'payables', 'cost_centers', 'dre', 'reports', 'payroll'];
const OPERATIONAL_MANAGE_RESOURCES: PermissionResource[] = ['orders', 'service_orders', 'technicians', 'employees'];

export const DEFAULT_PROFILES: DefaultProfileTemplate[] = [
  {
    name:        'Administrador',
    description: 'Acesso completo a todas as áreas do sistema.',
    grants:      ALL_MANAGE,
  },
  {
    name:        'Financeiro',
    description: 'Gerencia contas a receber/pagar, centros de custo, DRE e relatórios; visualiza o restante.',
    grants:      [...ALL_VIEW, ...FINANCE_MANAGE_RESOURCES.map(resource => ({ resource, action: 'manage' as const }))],
  },
  {
    name:        'Operacional',
    description: 'Visualiza tudo; gerencia pedidos, ordens de serviço e técnicos.',
    grants:      [...ALL_VIEW, ...OPERATIONAL_MANAGE_RESOURCES.map(resource => ({ resource, action: 'manage' as const }))],
  },
];

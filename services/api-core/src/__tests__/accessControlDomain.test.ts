import { describe, it, expect } from 'vitest';
import {
  AccessControlDomainError, assertActorIsOwner, assertNotOwnerRole, assertCanAssignAccessProfile,
  assertProfileDeletable, validateProfileName, usesAccessProfile, isPermissionResource, isPermissionAction,
  resolveEffectivePermissions, permissionsToMap, DEFAULT_PROFILES, PERMISSION_RESOURCES,
} from '../domain/accessControl/accessControlDomain';

describe('assertActorIsOwner', () => {
  it('permite quando o ator é owner', () => {
    expect(() => assertActorIsOwner('owner')).not.toThrow();
  });

  it('bloqueia qualquer outro papel', () => {
    expect(() => assertActorIsOwner('user')).toThrow(AccessControlDomainError);
    expect(() => assertActorIsOwner(undefined)).toThrow(AccessControlDomainError);
  });
});

describe('assertNotOwnerRole', () => {
  it('bloqueia setar role owner', () => {
    expect(() => assertNotOwnerRole('owner')).toThrow(AccessControlDomainError);
  });

  it('permite qualquer outro valor', () => {
    expect(() => assertNotOwnerRole('user')).not.toThrow();
    expect(() => assertNotOwnerRole(undefined)).not.toThrow();
  });
});

describe('usesAccessProfile / assertCanAssignAccessProfile', () => {
  it('owner e technician nunca usam perfil', () => {
    expect(usesAccessProfile('owner')).toBe(false);
    expect(usesAccessProfile('technician')).toBe(false);
    expect(usesAccessProfile('user')).toBe(true);
  });

  it('bloqueia atribuir perfil a owner/technician', () => {
    expect(() => assertCanAssignAccessProfile('owner')).toThrow(AccessControlDomainError);
    expect(() => assertCanAssignAccessProfile('technician')).toThrow(AccessControlDomainError);
    expect(() => assertCanAssignAccessProfile('user')).not.toThrow();
  });
});

describe('assertProfileDeletable', () => {
  it('bloqueia excluir perfil com usuários vinculados', () => {
    expect(() => assertProfileDeletable(1)).toThrow(AccessControlDomainError);
  });

  it('permite excluir perfil sem usuário vinculado', () => {
    expect(() => assertProfileDeletable(0)).not.toThrow();
  });
});

describe('validateProfileName', () => {
  it('rejeita nome vazio ou só espaços', () => {
    expect(() => validateProfileName('')).toThrow(AccessControlDomainError);
    expect(() => validateProfileName('   ')).toThrow(AccessControlDomainError);
  });

  it('aceita nome não vazio', () => {
    expect(() => validateProfileName('Financeiro')).not.toThrow();
  });
});

describe('isPermissionResource / isPermissionAction', () => {
  it('valida recursos e ações conhecidos', () => {
    expect(isPermissionResource('clients')).toBe(true);
    expect(isPermissionResource('nao_existe')).toBe(false);
    expect(isPermissionAction('view')).toBe(true);
    expect(isPermissionAction('manage')).toBe(true);
    expect(isPermissionAction('delete')).toBe(false);
  });
});

describe('resolveEffectivePermissions', () => {
  it('owner faz bypass total, mesmo sem nenhum grant', () => {
    const effective = resolveEffectivePermissions('owner', []);
    expect(effective.can('clients', 'view')).toBe(true);
    expect(effective.can('users', 'manage')).toBe(true);
  });

  it('usuário sem grants não pode nada', () => {
    const effective = resolveEffectivePermissions('user', []);
    expect(effective.can('clients', 'view')).toBe(false);
    expect(effective.can('clients', 'manage')).toBe(false);
  });

  it('grant de view não concede manage', () => {
    const effective = resolveEffectivePermissions('user', [{ resource: 'clients', action: 'view' }]);
    expect(effective.can('clients', 'view')).toBe(true);
    expect(effective.can('clients', 'manage')).toBe(false);
  });

  it('grant de manage sempre implica view (mesmo sem grant explícito de view)', () => {
    const effective = resolveEffectivePermissions('user', [{ resource: 'clients', action: 'manage' }]);
    expect(effective.can('clients', 'view')).toBe(true);
    expect(effective.can('clients', 'manage')).toBe(true);
  });

  it('grants de um recurso não vazam para outro', () => {
    const effective = resolveEffectivePermissions('user', [{ resource: 'clients', action: 'manage' }]);
    expect(effective.can('materials', 'view')).toBe(false);
  });
});

describe('permissionsToMap', () => {
  it('projeta o mapa completo de recursos, mesmo os sem grant', () => {
    const effective = resolveEffectivePermissions('user', [{ resource: 'clients', action: 'manage' }]);
    const map = permissionsToMap(effective);
    expect(map.clients).toEqual({ view: true, manage: true });
    expect(map.materials).toEqual({ view: false, manage: false });
    expect(Object.keys(map)).toHaveLength(PERMISSION_RESOURCES.length);
  });
});

describe('DEFAULT_PROFILES', () => {
  it('tem 3 perfis padrão com nomes únicos', () => {
    expect(DEFAULT_PROFILES).toHaveLength(3);
    const names = DEFAULT_PROFILES.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('Administrador tem manage em todos os recursos', () => {
    const admin = DEFAULT_PROFILES.find(p => p.name === 'Administrador')!;
    const effective = resolveEffectivePermissions('user', admin.grants);
    for (const resource of PERMISSION_RESOURCES) {
      expect(effective.can(resource, 'manage')).toBe(true);
    }
  });

  it('Financeiro só gerencia receivables/payables/cost_centers/dre/reports, vê o resto', () => {
    const finance = DEFAULT_PROFILES.find(p => p.name === 'Financeiro')!;
    const effective = resolveEffectivePermissions('user', finance.grants);
    expect(effective.can('receivables', 'manage')).toBe(true);
    expect(effective.can('clients', 'manage')).toBe(false);
    expect(effective.can('clients', 'view')).toBe(true);
  });
});

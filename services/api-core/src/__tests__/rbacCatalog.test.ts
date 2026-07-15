import { describe, it, expect } from 'vitest';
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG, isPermissionKey } from '../rbac/permissions';
import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '../rbac/roleMatrix';

// Invariantes do catálogo e da matriz-semente — puro, sem banco. Pega drift
// (ex.: um papel referenciar uma permissão que não existe mais).

describe('catálogo de permissões', () => {
  it('toda chave tem o formato modulo:acao', () => {
    for (const p of PERMISSION_CATALOG) {
      expect(p.key).toBe(`${p.module}:${p.action}`);
      expect(p.key).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('não há chaves duplicadas', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('isPermissionKey aceita válidas e rejeita inválidas', () => {
    expect(isPermissionKey('clients:create')).toBe(true);
    expect(isPermissionKey('roles:manage')).toBe(true);
    expect(isPermissionKey('nope:nope')).toBe(false);
    expect(isPermissionKey('clients')).toBe(false);
  });
});

describe('matriz de papéis de sistema', () => {
  it('cobre exatamente os 5 papéis', () => {
    expect(Object.keys(SYSTEM_ROLE_PERMISSIONS).sort()).toEqual(SYSTEM_ROLES.map(r => r.key).sort());
  });

  it('só referencia permissões que existem no catálogo', () => {
    for (const [role, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(isPermissionKey(p), `${role} referencia permissão inexistente: ${p}`).toBe(true);
      }
    }
  });

  it('owner tem TODAS as permissões', () => {
    expect([...SYSTEM_ROLE_PERMISSIONS.owner].sort()).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it('admin tem tudo menos billing:manage', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toContain('roles:manage');
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain('billing:manage');
  });

  it('technician só acessa o portal', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.technician).toEqual(['portal:access']);
  });

  it('user (operador): cria mas não exclui, e não administra', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.user).toContain('clients:create');
    expect(SYSTEM_ROLE_PERMISSIONS.user).not.toContain('clients:delete');
    expect(SYSTEM_ROLE_PERMISSIONS.user).not.toContain('users:view');
    expect(SYSTEM_ROLE_PERMISSIONS.user).not.toContain('roles:manage');
  });

  it('user (operador): vê técnicos — precisa pra agendar visita de Ordem de Serviço', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.user).toContain('technicians:view');
  });
});

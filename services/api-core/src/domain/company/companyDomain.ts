// Domínio de Empresa/CNPJ (multi-empresa, regra 40) — puro, sem I/O.
// nfe_configs é a entidade "Empresa" do tenant: cada linha é um CNPJ que o
// tenant opera. Este módulo só contém os invariantes de negócio; toda leitura
// e escrita de banco vive em services/companyService.ts.

import { isValidCNPJ, normalizeCNPJ } from '../cnpj/cnpjDomain';

export class CompanyDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'CompanyDomainError';
  }
}

export interface CompanyLike {
  id:         string;
  cnpj:       string;
  is_default: boolean;
  is_active:  boolean;
}

/**
 * Uma empresa não pode ser desativada se for a padrão do tenant, ou se for a
 * última empresa ativa (o tenant sempre precisa de ao menos uma identidade
 * fiscal para operar).
 */
export function canDeactivate(companies: CompanyLike[], companyId: string): boolean {
  const target = companies.find(c => c.id === companyId);
  if (!target) return false;
  if (target.is_default) return false;

  const activeCount = companies.filter(c => c.is_active).length;
  if (target.is_active && activeCount <= 1) return false;

  return true;
}

export interface CnpjValidationResult {
  ok:    boolean;
  error?: 'invalid_cnpj' | 'duplicate_cnpj';
}

/**
 * Valida um CNPJ candidato para uma nova empresa do tenant: precisa ser um
 * CNPJ válido (regra 36) e não pode já existir (normalizado) entre as
 * empresas já cadastradas para esse tenant.
 */
export function validateNewCompanyCnpj(existingCnpjs: string[], candidateCnpj: string): CnpjValidationResult {
  if (!isValidCNPJ(candidateCnpj)) {
    return { ok: false, error: 'invalid_cnpj' };
  }

  const normalized = normalizeCNPJ(candidateCnpj);
  const isDuplicate = existingCnpjs.some(c => normalizeCNPJ(c) === normalized);
  if (isDuplicate) {
    return { ok: false, error: 'duplicate_cnpj' };
  }

  return { ok: true };
}

import { describe, it, expect } from 'vitest';
import { validateAndNormalizeLead, normalizeEmail, LeadCaptureDomainError } from '../leadCaptureDomain';

describe('validateAndNormalizeLead', () => {
  it('rejeita sem nome', () => {
    expect(() => validateAndNormalizeLead({ email: 'a@b.com' }))
      .toThrow(LeadCaptureDomainError);
  });

  it('rejeita sem e-mail e sem telefone (precisa de ao menos um contato)', () => {
    expect(() => validateAndNormalizeLead({ name: 'Ana' }))
      .toThrow(LeadCaptureDomainError);
  });

  it('rejeita e-mail com formato inválido', () => {
    expect(() => validateAndNormalizeLead({ name: 'Ana', email: 'não-é-email' }))
      .toThrow(LeadCaptureDomainError);
  });

  it('aceita só com nome + telefone (sem e-mail)', () => {
    const lead = validateAndNormalizeLead({ name: 'Ana', phone: '11999999999' });
    expect(lead.person_type).toBe('PF');
    expect(lead.full_name).toBe('Ana');
    expect(lead.email).toBeNull();
    expect(lead.phone).toBe('11999999999');
  });

  it('infere PF quando não há company_name nem cnpj', () => {
    const lead = validateAndNormalizeLead({ name: 'Ana', email: 'ana@ex.com' });
    expect(lead.person_type).toBe('PF');
    expect(lead.full_name).toBe('Ana');
    expect(lead.company_name).toBeNull();
  });

  it('infere PJ quando há company_name', () => {
    const lead = validateAndNormalizeLead({ name: 'Ana', email: 'ana@ex.com', company_name: 'Acme Ltda' });
    expect(lead.person_type).toBe('PJ');
    expect(lead.company_name).toBe('Acme Ltda');
    expect(lead.full_name).toBeNull();
  });

  it('infere PJ quando há cnpj, mesmo sem company_name explícito (usa o nome como razão social)', () => {
    const lead = validateAndNormalizeLead({ name: 'Acme', email: 'a@ex.com', cnpj: '11444777000161' });
    expect(lead.person_type).toBe('PJ');
    expect(lead.company_name).toBe('Acme');
  });

  it('normaliza e-mail pra minúsculo', () => {
    const lead = validateAndNormalizeLead({ name: 'Ana', email: 'ANA@EX.COM' });
    expect(lead.email).toBe('ana@ex.com');
  });

  it('joga message pra notes, sem mensagem vira null', () => {
    expect(validateAndNormalizeLead({ name: 'Ana', email: 'a@b.com', message: 'Quero um orçamento' }).notes)
      .toBe('Quero um orçamento');
    expect(validateAndNormalizeLead({ name: 'Ana', email: 'a@b.com' }).notes).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('remove espaços e converte pra minúsculo', () => {
    expect(normalizeEmail('  Ana@Exemplo.COM  ')).toBe('ana@exemplo.com');
  });
});

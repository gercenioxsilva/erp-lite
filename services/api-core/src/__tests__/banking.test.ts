import { describe, it, expect } from 'vitest';
import {
  validateBankingData,
  getBankName,
  validateAccountDigitItau,
  generateNossoNumero,
  formatAccount,
  isValidBillingProvider,
} from '../lib/banking';

describe('banking.ts', () => {
  describe('validateBankingData', () => {
    it('passes when all banking fields are provided', () => {
      expect(() => {
        validateBankingData({
          bank_code: '341',
          agency: '1234',
          account: '16102-5',
          account_digit: '5',
        });
      }).not.toThrow();
    });

    it('passes when no banking fields are provided', () => {
      expect(() => {
        validateBankingData({});
      }).not.toThrow();
    });

    it('throws when bank_code is missing but other fields are provided', () => {
      expect(() => {
        validateBankingData({ agency: '1234', account: '16102-5' });
      }).toThrow('bank_code é obrigatório');
    });

    it('throws when bank_code is invalid', () => {
      expect(() => {
        validateBankingData({
          bank_code: '999',
          agency: '1234',
          account: '16102-5',
          account_digit: '5',
        });
      }).toThrow('bank_code \'999\' inválido');
    });

    it('throws when agency is invalid format', () => {
      expect(() => {
        validateBankingData({
          bank_code: '341',
          agency: '123',  // too short
          account: '16102-5',
          account_digit: '5',
        });
      }).toThrow('agency deve conter 4 ou 5 dígitos');
    });

    it('throws when account is invalid format', () => {
      expect(() => {
        validateBankingData({
          bank_code: '341',
          agency: '1234',
          account: 'invalid',
          account_digit: '5',
        });
      }).toThrow('account deve estar no formato NNNNN ou NNNNN-D');
    });

    it('throws when account_digit is invalid', () => {
      expect(() => {
        validateBankingData({
          bank_code: '341',
          agency: '1234',
          account: '16102-5',
          account_digit: 'X',
        });
      }).toThrow('account_digit deve conter 1 ou 2 dígitos');
    });
  });

  describe('getBankName', () => {
    it('returns bank name for valid code', () => {
      expect(getBankName('341')).toBe('Itaú Unibanco');
      expect(getBankName('033')).toBe('Banco Santander');
      expect(getBankName('001')).toBe('Banco do Brasil');
    });

    it('returns generic name for unknown code', () => {
      expect(getBankName('999')).toBe('Banco desconhecido');
    });
  });

  describe('validateAccountDigitItau', () => {
    it('returns true for valid digit', () => {
      expect(validateAccountDigitItau('16102', '5')).toBe(true);
      expect(validateAccountDigitItau('16102', '12')).toBe(true);
    });

    it('returns false for invalid digit', () => {
      expect(validateAccountDigitItau('16102', 'X')).toBe(false);
      expect(validateAccountDigitItau('16102', '')).toBe(false);
    });
  });

  describe('generateNossoNumero', () => {
    it('generates 20-digit string', () => {
      const num = generateNossoNumero('550e8400-e29b-41d4-a716-446655440000', 1);
      expect(num).toHaveLength(20);
      expect(/^\d{20}$/.test(num)).toBe(true);
    });

    it('generates different numbers for different sequences', () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      const num1 = generateNossoNumero(id, 1);
      const num2 = generateNossoNumero(id, 2);
      expect(num1).not.toBe(num2);
    });
  });

  describe('formatAccount', () => {
    it('formats account with digit', () => {
      expect(formatAccount('16102-5')).toBe('16.102-5');
    });

    it('returns account without digit unchanged', () => {
      expect(formatAccount('1610200000')).toBe('1610200000');
    });

    it('handles empty string', () => {
      expect(formatAccount('')).toBe('');
    });
  });

  describe('isValidBillingProvider', () => {
    it('returns true for valid providers', () => {
      expect(isValidBillingProvider('brcode')).toBe(true);
      expect(isValidBillingProvider('itau')).toBe(true);
      expect(isValidBillingProvider('santander')).toBe(true);
      expect(isValidBillingProvider('bradesco')).toBe(true);
    });

    it('returns false for invalid providers', () => {
      expect(isValidBillingProvider('invalid')).toBe(false);
      expect(isValidBillingProvider('nubank')).toBe(false);
    });
  });
});

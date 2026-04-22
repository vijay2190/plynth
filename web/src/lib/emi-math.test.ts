import { describe, expect, it } from 'vitest';
import { calcEMI, remainingBalance, totalInterest } from './emi-math';

describe('emi-math', () => {
  it('calcEMI: P=10L, 8.5%, 240m ≈ 8678', () => {
    expect(Math.round(calcEMI(1_000_000, 8.5, 240))).toBe(8678);
  });

  it('remainingBalance: zero when fully paid', () => {
    expect(remainingBalance(1_000_000, 8.5, 240, 240)).toBe(0);
  });

  it('remainingBalance: equals principal at month 0', () => {
    expect(Math.round(remainingBalance(1_000_000, 8.5, 240, 0))).toBe(1_000_000);
  });

  it('totalInterest: positive', () => {
    const emi = calcEMI(1_000_000, 8.5, 240);
    expect(totalInterest(1_000_000, emi, 240)).toBeGreaterThan(0);
  });

  it('zero interest behaves linearly', () => {
    expect(calcEMI(12000, 0, 12)).toBe(1000);
    expect(remainingBalance(12000, 0, 12, 6)).toBe(6000);
  });
});

// Standard amortization helpers for EMI/loan math.
// All amounts in the same currency unit (e.g., INR rupees).

export function monthlyRate(annualPct: number): number {
  return annualPct / 100 / 12;
}

/**
 * Compute EMI given principal P, annual interest %, tenure in months.
 * Formula: P * r * (1+r)^n / ((1+r)^n - 1)
 */
export function calcEMI(principal: number, annualPct: number, months: number): number {
  if (months <= 0) return 0;
  const r = monthlyRate(annualPct);
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/**
 * Remaining balance after `paid` months out of `n` total.
 * Formula: P * [(1+r)^n - (1+r)^p] / [(1+r)^n - 1]
 */
export function remainingBalance(
  principal: number,
  annualPct: number,
  totalMonths: number,
  monthsPaid: number,
): number {
  if (monthsPaid >= totalMonths) return 0;
  const r = monthlyRate(annualPct);
  if (r === 0) return Math.max(0, principal - (principal / totalMonths) * monthsPaid);
  const fN = Math.pow(1 + r, totalMonths);
  const fP = Math.pow(1 + r, monthsPaid);
  return (principal * (fN - fP)) / (fN - 1);
}

export function totalInterest(principal: number, emi: number, months: number): number {
  return Math.max(0, emi * months - principal);
}

export function monthsBetween(startISO: string, asOfISO: string = new Date().toISOString()): number {
  const a = new Date(startISO);
  const b = new Date(asOfISO);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

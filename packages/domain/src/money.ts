export type Currency = "CLP" | "USD";

export type Money = Readonly<{ amountMinor: number; currency: Currency }>;

export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Money must use safe integer minor units.");
  return Object.freeze({ amountMinor, currency });
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function multiplyMoney(value: Money, multiplier: number): Money {
  if (!Number.isFinite(multiplier)) throw new Error("Multiplier must be finite.");
  return money(Math.round(value.amountMinor * multiplier), value.currency);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) throw new Error("Currency mismatch.");
}

import { describe, expect, it } from "vitest";
import { addMoney, money, subtractMoney } from "../packages/domain/src/money.js";

describe("Money", () => {
  it("calculates in integer minor units", () => {
    expect(addMoney(money(10_000, "CLP"), money(2_500, "CLP"))).toEqual({ amountMinor: 12_500, currency: "CLP" });
    expect(subtractMoney(money(10_000, "CLP"), money(2_500, "CLP"))).toEqual({ amountMinor: 7_500, currency: "CLP" });
  });

  it("rejects currency mixing", () => {
    expect(() => addMoney(money(1, "CLP"), money(1, "USD"))).toThrow(/Currency mismatch/);
  });
});

import { describe, expect, it } from "vitest";
import { decideWake } from "../packages/agent-kernel/src/wakePolicy.js";

const signals = [
  {
    kind: "stock.low",
    entityId: "sku1",
    observedAt: "2026-07-26T10:00:00Z",
    materialValue: 2,
    urgency: 1,
    expectedImpact: 10,
    confidence: 0.9,
  },
];

describe("wake policy", () => {
  it("wakes for positive utility new signals", () => {
    expect(decideWake({ signals, now: "2026-07-26T10:00:00Z", estimatedCost: 1 }).shouldWake).toBe(
      true,
    );
  });
  it("skips unchanged signals despite timestamp drift", () => {
    const initial = decideWake({ signals, now: "2026-07-26T10:00:00Z", estimatedCost: 1 });
    const later = decideWake({
      signals: [{ ...signals[0]!, observedAt: "2026-07-26T10:15:00Z" }],
      previousSignalsHash: initial.signalsHash,
      now: "2026-07-26T10:15:00Z",
      estimatedCost: 1,
    });
    expect(later.reason).toBe("unchanged");
  });
});

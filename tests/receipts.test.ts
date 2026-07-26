import { describe, expect, it } from "vitest";
import { createReceipt } from "../packages/agent-kernel/src/receipts.js";

describe("verifiable receipts", () => {
  it("is deterministic for object key order", () => {
    const common = {
      id: "r1",
      type: "proposal" as const,
      accountId: "plasticov",
      actionId: "a1",
      contentHash: "c",
      policyHash: "p",
      evidenceHash: "e",
      previousReceiptHash: null,
      recordedAt: "2026-07-26T00:00:00.000Z",
    };
    expect(createReceipt({ ...common, payload: { b: 2, a: 1 } }).payloadHash).toBe(
      createReceipt({ ...common, payload: { a: 1, b: 2 } }).payloadHash,
    );
  });
});

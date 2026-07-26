import { describe, expect, it } from "vitest";
import type { BusinessAction } from "@eauto/domain";
import { InMemoryActionRepository, InMemoryReceiptRepository } from "@eauto/infrastructure";
import { ActionService } from "../packages/application/src/actionService.js";

const action: BusinessAction = {
  id: "action-1",
  accountId: "plasticov",
  kind: "listing-edit",
  target: "MLC1",
  exactChanges: [{ field: "title", from: "Old", to: "New" }],
  rationale: "Improve clarity",
  risk: "low",
  status: "draft",
  evidenceBundle: {
    id: "evidence-hash",
    accountId: "plasticov",
    references: [{ id: "e1", source: "test", sourceRecordId: "MLC1", observedAt: "2026-07-26T00:00:00.000Z", freshness: "fresh", confidence: "high", contentHash: "abc" }],
    complete: true,
    missingInputs: [],
  },
  policyVersion: "policy-v1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("ActionService", () => {
  it("requires review and approval, executes, verifies, and chains receipts", async () => {
    const actions = new InMemoryActionRepository();
    const receipts = new InMemoryReceiptRepository();
    let now = 0;
    const service = new ActionService(
      actions,
      receipts,
      {
        execute: () => Promise.resolve({ providerReceipt: { requestId: "remote-1" } }),
        verify: () => Promise.resolve({ verified: true, observedState: { title: "New" } }),
      },
      { now: () => new Date(1_800_000_000_000 + now++) },
      { next: (prefix) => `${prefix}-${now}` },
    );

    await service.propose(action);
    await service.markReviewed(action.id);
    await service.approve(action.id, "sebastian");
    const result = await service.execute(action.id);
    expect(result.status).toBe("verified");
    const chain = await receipts.listForAction(action.id);
    expect(chain.map((receipt) => receipt.type)).toEqual(["proposal", "review", "approval", "execution", "verification"]);
    expect(chain[1]?.previousReceiptHash).toBe(chain[0]?.chainHash);
  });

  it("refuses incomplete evidence", async () => {
    const service = new ActionService(new InMemoryActionRepository(), new InMemoryReceiptRepository(), { execute: () => Promise.resolve({ providerReceipt: {} }), verify: () => Promise.resolve({ verified: true, observedState: {} }) }, { now: () => new Date() }, { next: (prefix) => prefix });
    await expect(service.propose({ ...action, evidenceBundle: { ...action.evidenceBundle, complete: false, missingInputs: ["cost"] } })).rejects.toThrow(/Evidence incomplete/);
  });
});

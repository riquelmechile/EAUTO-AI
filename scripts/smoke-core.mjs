import assert from "node:assert/strict";
import { money, addMoney } from "../packages/domain/dist/index.js";
import { compilePrompt, decideWake, createReceipt } from "../packages/agent-kernel/dist/index.js";
import { ActionService } from "../packages/application/dist/index.js";
import { InMemoryActionRepository, InMemoryReceiptRepository } from "../packages/infrastructure/dist/index.js";

assert.deepEqual(addMoney(money(1000, "CLP"), money(500, "CLP")), { amountMinor: 1500, currency: "CLP" });

const stable = {
  constitution: "constitution-v1",
  globalSafetyPolicy: "safety-v1",
  toolContract: "tools-v1",
  agentIdentity: "pricing-v1",
  accountPolicy: "plasticov-v1",
  skillManifest: "pricing-skill-v1",
};
const p1 = compilePrompt({ ...stable, recoveredContext: "memory-a", volatileInput: "signal-a" });
const p2 = compilePrompt({ ...stable, recoveredContext: "memory-b", volatileInput: "signal-b" });
assert.equal(p1.stableHash, p2.stableHash);
assert.notEqual(p1.fullHash, p2.fullHash);

const wake = decideWake({
  signals: [{ kind: "stock.low", entityId: "sku-1", observedAt: new Date().toISOString(), materialValue: 2, urgency: 1, expectedImpact: 100, confidence: 0.9 }],
  now: new Date().toISOString(),
  estimatedCost: 1,
});
assert.equal(wake.shouldWake, true);

const firstReceipt = createReceipt({
  id: "receipt-1",
  type: "proposal",
  accountId: "plasticov",
  actionId: "action-1",
  contentHash: "content",
  policyHash: "policy",
  evidenceHash: "evidence",
  previousReceiptHash: null,
  payload: { b: 2, a: 1 },
  recordedAt: "2026-07-26T00:00:00.000Z",
});
assert.equal(firstReceipt.payloadHash.length, 64);

const actions = new InMemoryActionRepository();
const receipts = new InMemoryReceiptRepository();
let sequence = 0;
const service = new ActionService(
  actions,
  receipts,
  {
    execute: async () => ({ providerReceipt: { requestId: "simulated" } }),
    verify: async () => ({ verified: true, observedState: { title: "Nuevo" } }),
  },
  { now: () => new Date(1_800_000_000_000 + sequence++) },
  { next: (prefix) => `${prefix}-${sequence}` },
);
const action = {
  id: "action-1",
  accountId: "plasticov",
  kind: "listing-edit",
  target: "MLC1",
  exactChanges: [{ field: "title", from: "Anterior", to: "Nuevo" }],
  rationale: "Mejorar claridad",
  risk: "low",
  status: "draft",
  evidenceBundle: {
    id: "evidence-hash",
    accountId: "plasticov",
    references: [{ id: "e1", source: "smoke", sourceRecordId: "MLC1", observedAt: "2026-07-26T00:00:00.000Z", freshness: "fresh", confidence: "high", contentHash: "abc" }],
    complete: true,
    missingInputs: [],
  },
  policyVersion: "policy-v1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
await service.propose(action);
await service.markReviewed(action.id);
await service.approve(action.id, "sebastian");
const completed = await service.execute(action.id);
assert.equal(completed.status, "verified");
assert.deepEqual((await receipts.listForAction(action.id)).map((r) => r.type), ["proposal", "review", "approval", "execution", "verification"]);

console.log("Core smoke passed: money, cache, wake policy, receipts, approval and verification.");

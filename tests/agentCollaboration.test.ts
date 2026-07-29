import { describe, expect, it } from "vitest";
import {
  AgentMessageBusService,
  EvidenceResponseRouter,
  SemanticMemoryService,
  type EvidenceResponder,
} from "@eauto/application";
import type { EvidenceDocument } from "@eauto/domain";
import { InMemoryCompanyIntelligenceRepository } from "@eauto/infrastructure";

function harness() {
  const repository = new InMemoryCompanyIntelligenceRepository();
  let sequence = 0;
  const clock = { now: () => new Date("2026-07-28T12:00:00.000Z") };
  const ids = { next: (prefix: string) => `${prefix}-${++sequence}` };
  return { repository, clock, ids };
}

describe("agent collaboration", () => {
  it("publishes idempotently, leases once and completes messages", async () => {
    const { repository, clock, ids } = harness();
    const bus = new AgentMessageBusService(repository, clock, ids);
    const input = {
      idempotencyKey: "message-idempotency-1",
      organizationId: "maustian",
      accountId: "plasticov",
      senderAgentId: "analytics",
      recipientAgentId: "pricing",
      kind: "command" as const,
      subject: "review-margin",
      payload: { listingId: "MLC1" },
      evidenceRefs: ["profitability:1"],
    };
    const first = await bus.publish(input);
    const duplicate = await bus.publish(input);
    expect(duplicate.id).toBe(first.id);

    const leased = await bus.lease({
      recipientAgentId: "pricing",
      owner: "worker-a",
      leaseMs: 30_000,
      limit: 10,
    });
    expect(leased).toHaveLength(1);
    expect(leased[0]).toMatchObject({ status: "processing", attempts: 1 });
    expect(
      await bus.lease({ recipientAgentId: "pricing", owner: "worker-b", leaseMs: 30_000 }),
    ).toHaveLength(0);
    await bus.complete(leased[0]!);
    expect(await bus.list({ organizationId: "maustian", accountId: "plasticov" })).toEqual([
      expect.objectContaining({ id: first.id, status: "completed" }),
    ]);
    expect(await bus.list({ organizationId: "maustian", accountId: "maustian" })).toHaveLength(0);
  });

  it("routes evidence deterministically and freezes a response", async () => {
    const { repository, clock, ids } = harness();
    const document: EvidenceDocument = Object.freeze({
      reference: Object.freeze({
        id: "listing:MLC1",
        source: "mercadolibre-listing",
        sourceRecordId: "MLC1",
        observedAt: "2026-07-28T11:59:00.000Z",
        freshness: "fresh",
        confidence: "high",
        contentHash: "a".repeat(64),
      }),
      subject: "catalog",
      kind: "listing-snapshot",
      authority: "authoritative",
      expiresAt: "2026-07-28T12:15:00.000Z",
      payload: { itemId: "MLC1" },
    });
    const responder: EvidenceResponder = {
      id: "catalog-reader",
      subjects: ["catalog"],
      respond: () => Promise.resolve({ documents: [document], missingInputs: [] }),
    };
    const router = new EvidenceResponseRouter([responder], repository, clock, ids, {
      workerId: "evidence-worker",
      leaseMs: 30_000,
      maximumAttempts: 3,
    });
    const request = await router.request({
      idempotencyKey: "evidence-idempotency-1",
      organizationId: "maustian",
      accountId: "plasticov",
      conversationId: "conversation-1",
      correlationId: "correlation-1",
      requesterAgentId: "catalog",
      subject: "catalog",
      purpose: "verify listing",
      requiredKinds: ["listing-snapshot"],
      maximumAgeMs: 900_000,
    });
    expect(await router.processBatch()).toEqual({ leased: 1, fulfilled: 1, failed: 0 });
    expect(
      await repository.getEvidenceResponse({
        organizationId: "maustian",
        accountId: "plasticov",
        requestId: request.id,
      }),
    ).toMatchObject({ complete: true, responderId: "catalog-reader", documents: [document] });
  });

  it("stores semantic memory with provenance, ranking and collision reconciliation", async () => {
    const { repository, clock, ids } = harness();
    const memory = new SemanticMemoryService(repository, clock, ids);
    const first = await memory.remember({
      organizationId: "maustian",
      accountId: "plasticov",
      topicKey: "pricing:MLC1",
      title: "Margin floor",
      observation: "The verified margin floor is 35 percent.",
      rationale: "Owner policy and profitability receipt agree.",
      scopeDescription: "Plasticov listing MLC1",
      keywords: ["pricing", "margin", "MLC1"],
      sourceRefs: ["policy:v1", "profitability:1"],
      confidence: "high",
      verifiedOutcome: true,
    });
    const results = await memory.retrieve({
      organizationId: "maustian",
      accountId: "plasticov",
      query: "pricing margin",
      requireVerifiedOutcome: true,
    });
    expect(results[0]?.entry.id).toBe(first.id);

    const replacement = await memory.remember({
      organizationId: "maustian",
      accountId: "plasticov",
      topicKey: "pricing:MLC1",
      title: "Updated margin floor",
      observation: "The verified margin floor is 38 percent.",
      rationale: "A newer owner policy supersedes the prior rule.",
      scopeDescription: "Plasticov listing MLC1",
      sourceRefs: ["policy:v2"],
      confidence: "high",
      verifiedOutcome: true,
      supersedesId: first.id,
    });
    expect(replacement.revision).toBe(2);
    const history = await memory.history({
      organizationId: "maustian",
      accountId: "plasticov",
      topicKey: "pricing:MLC1",
    });
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: "superseded" }),
        expect.objectContaining({ id: replacement.id, status: "active" }),
      ]),
    );
    expect(
      await memory.retrieve({
        organizationId: "maustian",
        accountId: "maustian",
        query: "pricing margin",
      }),
    ).toHaveLength(0);
  });
});

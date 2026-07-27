import { describe, expect, it } from "vitest";
import type { EvidenceDocument, OperationalEvidencePack, ShadowAgentOutput } from "@eauto/domain";
import {
  AgentOsService,
  GovernedWorkOrderProcessor,
  GovernedWorkOrderService,
  OperationalIntelligenceService,
  ShadowLlmService,
  type LlmProviderGateway,
} from "@eauto/application";
import {
  InMemoryAgentOsRepository,
  InMemoryLlmRunRepository,
  InMemoryOperationalEvidenceReader,
  InMemoryOperationalIntelligenceRepository,
} from "@eauto/infrastructure";

const NOW = "2026-07-27T12:00:00.000Z";
const clock = { now: () => new Date(NOW) };

function idFactory() {
  let value = 0;
  return { next: (prefix: string) => `${prefix}_${++value}` };
}

function document(kind: string): EvidenceDocument {
  return Object.freeze({
    reference: Object.freeze({
      id: `evidence:${kind}`,
      source: "verified-test-source",
      sourceRecordId: `record:${kind}`,
      observedAt: NOW,
      freshness: "fresh",
      confidence: "high",
      contentHash: kind.padEnd(64, "a").slice(0, 64),
    }),
    subject: "economic",
    kind,
    authority: "authoritative",
    expiresAt: "2026-07-27T13:00:00.000Z",
    payload: Object.freeze({ kind, verified: true }),
  });
}

function pricingPack(): OperationalEvidencePack {
  const documents = Object.freeze(
    [
      "economic-snapshot",
      "market-evidence",
      "order-snapshot",
      "cost-evidence",
      "product-source",
    ].map(document),
  );
  return Object.freeze({
    id: "pack_pricing",
    organizationId: "maustian",
    accountId: "plasticov",
    purpose: "Analizar precio con evidencia completa",
    subject: "economic",
    generatedAt: NOW,
    expiresAt: "2026-07-27T13:00:00.000Z",
    documents,
    complete: true,
    missingInputs: Object.freeze([]),
    contentHash: "b".repeat(64),
  });
}

class FakeProvider implements LlmProviderGateway {
  constructor(private readonly output: ShadowAgentOutput) {}

  complete() {
    return Promise.resolve({
      providerRequestId: "provider-request-1",
      model: "deepseek-v4-pro" as const,
      systemFingerprint: "test-fingerprint",
      content: JSON.stringify(this.output),
      usage: Object.freeze({
        promptTokens: 10,
        cacheHitTokens: 5,
        cacheMissTokens: 5,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      }),
    });
  }
}

describe("operational intelligence governance", () => {
  it("rejects expired evidence before a work order can be enqueued", async () => {
    const repository = new InMemoryOperationalIntelligenceRepository();
    const pack = Object.freeze({ ...pricingPack(), expiresAt: "2026-07-27T11:00:00.000Z" });
    await repository.saveEvidencePack(pack);
    const service = new GovernedWorkOrderService(repository, clock, idFactory());
    await expect(
      service.enqueue({
        organizationId: "maustian",
        accountId: "plasticov",
        objectiveId: "objective-1",
        agentId: "pricing",
        capability: "proposal.create",
        taskClass: "analysis",
        instruction: "Analizar precio actual",
        evidencePackId: pack.id,
        signals: [
          {
            kind: "margin-risk",
            entityId: "MLC1",
            observedAt: NOW,
            materialValue: 1200,
            urgency: 1,
            expectedImpact: 100_000,
            confidence: 1,
          },
        ],
        estimatedCostMicrosUsd: 100,
        budgetMicrosUsd: 10_000,
        budgetMinorClp: 0,
        maximumAttempts: 3,
        idempotencyKey: "expired-pack-order",
      }),
    ).rejects.toThrow(/expired/);
  });

  it("does not admit memory from another account", async () => {
    const repository = new InMemoryOperationalIntelligenceRepository();
    const intelligence = new OperationalIntelligenceService(
      repository,
      new InMemoryOperationalEvidenceReader(),
      clock,
      idFactory(),
    );
    await intelligence.saveMemory({
      organizationId: "maustian",
      accountId: "maustian",
      kind: "lesson",
      content: "No mezclar esta cuenta con Plasticov.",
      sourceRefs: ["receipt:verified:1"],
      confidence: "high",
      verifiedOutcome: false,
      expiresAt: null,
    });
    const admitted = await intelligence.admittedMemory({
      organizationId: "maustian",
      accountId: "plasticov",
    });
    expect(admitted).toEqual([]);
  });

  it("deduplicates work orders by idempotency key", async () => {
    const repository = new InMemoryOperationalIntelligenceRepository();
    await repository.saveEvidencePack(pricingPack());
    const service = new GovernedWorkOrderService(repository, clock, idFactory());
    const input = {
      organizationId: "maustian",
      accountId: "plasticov",
      objectiveId: "objective-1",
      agentId: "pricing",
      capability: "proposal.create",
      taskClass: "analysis" as const,
      instruction: "Analizar precio actual",
      evidencePackId: "pack_pricing",
      signals: [
        {
          kind: "margin-risk",
          entityId: "MLC1",
          observedAt: NOW,
          materialValue: 1200,
          urgency: 1,
          expectedImpact: 100_000,
          confidence: 1,
        },
      ],
      estimatedCostMicrosUsd: 100,
      budgetMicrosUsd: 10_000,
      budgetMinorClp: 0,
      maximumAttempts: 3,
      idempotencyKey: "pricing-order-1",
    };
    const first = await service.enqueue(input);
    const second = await service.enqueue(input);
    expect(second.order.id).toBe(first.order.id);
  });

  it("runs CEO to director to specialist and creates only approval-gated proposals", async () => {
    const repository = new InMemoryOperationalIntelligenceRepository();
    const pack = pricingPack();
    await repository.saveEvidencePack(pack);
    const ids = idFactory();
    const intelligence = new OperationalIntelligenceService(
      repository,
      new InMemoryOperationalEvidenceReader(),
      clock,
      ids,
    );
    const workOrders = new GovernedWorkOrderService(repository, clock, ids);
    await workOrders.enqueue({
      organizationId: "maustian",
      accountId: "plasticov",
      objectiveId: "objective-1",
      agentId: "pricing",
      capability: "proposal.create",
      taskClass: "analysis",
      instruction: "Preparar una recomendación de precio sin ejecutar cambios.",
      evidencePackId: pack.id,
      signals: [
        {
          kind: "margin-risk",
          entityId: "MLC1",
          observedAt: NOW,
          materialValue: 1200,
          urgency: 1,
          expectedImpact: 100_000,
          confidence: 1,
        },
      ],
      estimatedCostMicrosUsd: 100,
      budgetMicrosUsd: 10_000,
      budgetMinorClp: 0,
      maximumAttempts: 3,
      idempotencyKey: "pricing-shadow-run",
    });
    const output: ShadowAgentOutput = Object.freeze({
      summary: "El precio requiere revisión.",
      findings: Object.freeze([
        {
          statement: "El margen está bajo el objetivo.",
          evidenceRefs: Object.freeze(["evidence:economic-snapshot"]),
          confidence: "high",
        },
      ]),
      proposals: Object.freeze([
        {
          action: "Proponer aumento de precio para revisión humana.",
          rationale: "Recuperar margen mínimo.",
          evidenceRefs: Object.freeze(["evidence:economic-snapshot"]),
          expectedImpactMinorClp: 50_000,
          risk: "high",
          requiresHumanApproval: true,
        },
      ]),
      missingEvidenceKinds: Object.freeze([]),
      stopReason: "completed",
    });
    const agentOs = new AgentOsService(new InMemoryAgentOsRepository(), clock, ids);
    const llm = new ShadowLlmService(
      new FakeProvider(output),
      new InMemoryLlmRunRepository(),
      clock,
      ids,
      {
        timeoutMs: 5_000,
        defaultMaximumPromptTokens: 1_000,
        defaultMaximumOutputTokens: 500,
        dailyAccountBudgetMicrosUsd: 100_000,
      },
    );
    const processor = new GovernedWorkOrderProcessor(
      repository,
      intelligence,
      agentOs,
      llm,
      clock,
      ids,
      {
        workerId: "test-worker",
        leaseMs: 60_000,
        batchSize: 10,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        sessionDeadlineMs: 60_000,
        companyConstitution: "Constitución estable.",
        globalSafetyPolicy: "Sin escrituras externas.",
      },
    );
    const result = await processor.processBatch();
    expect(result).toEqual({ leased: 1, completed: 1, failed: 0 });
    const sessions = await agentOs.listSessions("plasticov", 20);
    expect(sessions.map((session) => session.agentId)).toEqual([
      "ceo",
      "finance-director",
      "pricing",
    ]);
    const proposals = await intelligence.listProposals("plasticov");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      status: "pending-approval",
      requiresHumanApproval: true,
    });
    const decided = await intelligence.decideProposal({
      id: proposals[0]?.id ?? "missing",
      accountId: "plasticov",
      status: "approved",
      decidedBy: "owner-1",
    });
    expect(decided?.status).toBe("approved");
    expect(await intelligence.listWorkOrders("plasticov")).toHaveLength(1);
  });
});

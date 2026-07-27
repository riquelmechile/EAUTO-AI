import { createHash } from "node:crypto";
import type {
  AgentRoleContract,
  AgentWorkOrder,
  ConsultativeMemoryRecord,
  OperationalEvidencePack,
  ShadowAgentOutput,
  ShadowProposalRecord,
} from "@eauto/domain";
import { assertUsableEvidencePack } from "@eauto/domain";
import { getCompanyAgentContract, type PromptCompilerInput } from "@eauto/agent-kernel";
import type { AgentOsService } from "./agentOsService.js";
import type { ShadowLlmService } from "./llmService.js";
import type {
  OperationalIntelligenceRepository,
  OperationalIntelligenceService,
} from "./operationalIntelligenceService.js";

export class GovernedWorkOrderProcessor {
  constructor(
    private readonly repository: OperationalIntelligenceRepository,
    private readonly intelligence: OperationalIntelligenceService,
    private readonly agentOs: AgentOsService,
    private readonly shadowLlm: ShadowLlmService | null,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
    private readonly config: Readonly<{
      workerId: string;
      leaseMs: number;
      batchSize: number;
      retryBaseMs: number;
      retryMaxMs: number;
      sessionDeadlineMs: number;
      companyConstitution: string;
      globalSafetyPolicy: string;
    }>,
  ) {}

  async processBatch(): Promise<Readonly<{ leased: number; completed: number; failed: number }>> {
    const now = this.clock.now();
    const orders = await this.repository.leaseWorkOrders({
      owner: this.config.workerId,
      now,
      leaseUntil: new Date(now.getTime() + this.config.leaseMs),
      limit: this.config.batchSize,
    });
    let completed = 0;
    let failed = 0;
    for (const order of orders) {
      try {
        await this.process(order);
        completed += 1;
      } catch (error) {
        await this.fail(order, error);
        failed += 1;
      }
    }
    return { leased: orders.length, completed, failed };
  }

  private async process(order: AgentWorkOrder): Promise<void> {
    if (!this.shadowLlm) throw new Error("shadow-llm-disabled");
    const pack = await this.repository.getEvidencePack({
      id: order.evidencePackId,
      organizationId: order.organizationId,
      accountId: order.accountId,
    });
    if (!pack) throw new Error("evidence-pack-not-found");
    assertScope(pack, order.organizationId, order.accountId);
    assertUsableEvidencePack(pack, this.clock.now().toISOString());
    const memory = await this.intelligence.admittedMemory({
      organizationId: order.organizationId,
      accountId: order.accountId,
      limit: 100,
    });
    const chain = contractChain(order.agentId);
    const availableEvidenceKinds = Object.freeze([
      "company-state",
      "account-state",
      "policy-version",
      "receipt-chain",
      "source-provenance",
      ...new Set(pack.documents.flatMap((document) => (document.kind ? [document.kind] : []))),
    ]);
    let parentSessionId: string | null = null;
    let runningLeafSessionId: string | null = null;

    for (let index = 0; index < chain.length; index += 1) {
      const contract = chain[index];
      if (!contract) throw new Error("agent-contract-chain-corrupt");
      const leaf = index === chain.length - 1;
      const capability = leaf ? resolveCapability(order, contract) : delegationCapability(contract);
      const created = await this.agentOs.createSession({
        organizationId: order.organizationId,
        accountId: order.accountId,
        objectiveId: order.objectiveId,
        agentId: contract.id,
        parentSessionId,
        requestedAction: capability,
        availableEvidenceKinds,
        evidenceRefs: Object.freeze(pack.documents.map((document) => document.reference.id)),
        autonomy: "inform",
        requestedBudgetMinorClp: Math.min(
          order.budgetMinorClp,
          contract.maximumDailyBudgetMinorClp,
        ),
        spentTodayMinorClp: 0,
        policyAllowed: true,
        stableContextRefs: Object.freeze([
          "company-constitution-v1",
          "company-policy-v1",
          contract.stablePromptVersion,
        ]),
        volatileContextRefs: Object.freeze([pack.id, ...memory.map((record) => record.id)]),
        idempotencyKey: `work-order:${order.id}:agent:${contract.id}`,
        deadlineAt: new Date(
          this.clock.now().getTime() + this.config.sessionDeadlineMs,
        ).toISOString(),
      });
      if (created.session.status !== "queued") {
        await this.repository.updateWorkOrder(
          Object.freeze({
            ...clearLease(order),
            status:
              created.session.status === "waiting-evidence"
                ? "waiting-evidence"
                : "waiting-approval",
            sessionId: created.session.id,
            memoryRefs: Object.freeze(memory.map((record) => record.id)),
            updatedAt: this.clock.now().toISOString(),
          }),
        );
        return;
      }
      const started = await this.agentOs.startSession({
        organizationId: order.organizationId,
        accountId: order.accountId,
        sessionId: created.session.id,
      });
      if (!leaf) {
        const nextContract = chain[index + 1];
        if (!nextContract) throw new Error("delegation-target-missing");
        await this.agentOs.completeSession({
          organizationId: order.organizationId,
          accountId: order.accountId,
          sessionId: started.id,
          outputRefs: Object.freeze([`delegation:${nextContract.id}`, `evidence-pack:${pack.id}`]),
          spentMinorClp: 0,
        });
        parentSessionId = started.id;
      } else {
        runningLeafSessionId = started.id;
      }
    }

    if (!runningLeafSessionId) throw new Error("leaf-session-not-created");
    try {
      const result = await this.shadowLlm.run({
        organizationId: order.organizationId,
        accountId: order.accountId,
        agentId: order.agentId,
        sessionId: runningLeafSessionId,
        taskClass: order.taskClass,
        prompt: buildPrompt(pack, memory, order, this.config),
        inputSchemaVersion: "work-order-v1",
        outputSchemaVersion: "shadow-output-v1",
        budgetMicrosUsd: order.budgetMicrosUsd,
      });
      if (!result.output || result.run.status !== "completed") {
        throw new Error(result.run.failureReason ?? `llm-run-${result.run.status}`);
      }
      validateOutputEvidence(result.output, pack);
      const proposalRefs: string[] = [];
      for (const proposal of result.output.proposals) {
        const record = makeProposal({
          proposal,
          order,
          sessionId: runningLeafSessionId,
          llmRunId: result.run.id,
          id: this.ids.next("proposal"),
          createdAt: this.clock.now().toISOString(),
        });
        await this.repository.saveProposal(record);
        proposalRefs.push(`proposal:${record.id}`);
      }
      const outputRefs = Object.freeze([`llm-run:${result.run.id}`, ...proposalRefs]);
      await this.agentOs.completeSession({
        organizationId: order.organizationId,
        accountId: order.accountId,
        sessionId: runningLeafSessionId,
        outputRefs,
        spentMinorClp: 0,
      });
      const completedAt = this.clock.now().toISOString();
      await this.repository.updateWorkOrder(
        Object.freeze({
          ...clearLease(order),
          status: "completed",
          sessionId: runningLeafSessionId,
          memoryRefs: Object.freeze(memory.map((record) => record.id)),
          outputRefs,
          completedAt,
          updatedAt: completedAt,
        }),
      );
    } catch (error) {
      await this.agentOs.failSession({
        organizationId: order.organizationId,
        accountId: order.accountId,
        sessionId: runningLeafSessionId,
        reason: error instanceof Error ? error.message : "Unknown governed run failure",
      });
      throw error;
    }
  }

  private async fail(order: AgentWorkOrder, error: unknown): Promise<void> {
    const dead = order.attempts >= order.maximumAttempts;
    const now = this.clock.now();
    const delay = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * 2 ** Math.max(0, order.attempts - 1),
    );
    await this.repository.updateWorkOrder(
      Object.freeze({
        ...clearLease(order),
        status: dead ? "dead" : "failed",
        availableAt: new Date(now.getTime() + delay).toISOString(),
        failureReason: sanitizeText(
          error instanceof Error ? error.message : "Unknown work order failure",
          500,
        ),
        completedAt: dead ? now.toISOString() : null,
        updatedAt: now.toISOString(),
      }),
    );
  }
}

function contractChain(agentId: string): readonly AgentRoleContract[] {
  const reversed: AgentRoleContract[] = [];
  let current = getCompanyAgentContract(agentId);
  if (!current) throw new Error(`Unknown company agent ${agentId}.`);
  while (current) {
    reversed.push(current);
    current = current.parentAgentId ? getCompanyAgentContract(current.parentAgentId) : undefined;
    if (reversed.length > 3) throw new Error("Agent hierarchy exceeds two delegation levels.");
  }
  const chain = reversed.reverse();
  if (chain[0]?.id !== "ceo") throw new Error("Agent hierarchy must originate at the CEO.");
  return Object.freeze(chain);
}

function delegationCapability(contract: AgentRoleContract): string {
  if (contract.level === "ceo") return "work-order.create";
  if (contract.level === "director") return "plan.create";
  throw new Error("Specialists cannot be intermediate delegation nodes.");
}

function resolveCapability(order: AgentWorkOrder, contract: AgentRoleContract): string {
  if (order.capability) {
    if (!contract.allowedCapabilities.includes(order.capability)) {
      throw new Error(`Capability ${order.capability} is not allowed for ${contract.id}.`);
    }
    return order.capability;
  }
  const preferred = ["proposal.create", "brief.create", "evidence.request"];
  const selected = preferred.find((capability) =>
    contract.allowedCapabilities.includes(capability),
  );
  const fallback = contract.allowedCapabilities[0];
  if (selected) return selected;
  if (fallback) return fallback;
  throw new Error(`Agent ${contract.id} has no allowed capability.`);
}

function buildPrompt(
  pack: OperationalEvidencePack,
  memory: readonly ConsultativeMemoryRecord[],
  order: AgentWorkOrder,
  config: Readonly<{ companyConstitution: string; globalSafetyPolicy: string }>,
): PromptCompilerInput {
  return {
    constitution: config.companyConstitution,
    globalSafetyPolicy: config.globalSafetyPolicy,
    toolContract: "Shadow mode. No tools and no external writes are available.",
    agentIdentity: JSON.stringify({ agentId: order.agentId, capability: order.capability ?? null }),
    accountPolicy: JSON.stringify({
      accountId: order.accountId,
      market: "MLC",
      externalWrites: false,
      evidencePackId: pack.id,
    }),
    skillManifest: JSON.stringify({ taskClass: order.taskClass }),
    recoveredContext: JSON.stringify({
      evidence: pack.documents.map((document) => ({
        reference: document.reference,
        kind: document.kind,
        subject: document.subject,
        authority: document.authority,
        payload: document.payload,
      })),
      memory: memory.map((record) => ({
        id: record.id,
        kind: record.kind,
        content: record.content,
        sourceRefs: record.sourceRefs,
        verifiedOutcome: record.verifiedOutcome,
      })),
    }),
    volatileInput: JSON.stringify({
      workOrderId: order.id,
      instruction: order.requestedAction,
      expectedUtility: order.expectedUtility,
    }),
  };
}

function validateOutputEvidence(output: ShadowAgentOutput, pack: OperationalEvidencePack): void {
  const allowed = new Set(pack.documents.map((document) => document.reference.id));
  const references = [
    ...output.findings.flatMap((finding) => finding.evidenceRefs),
    ...output.proposals.flatMap((proposal) => proposal.evidenceRefs),
  ];
  const invalid = references.find((reference) => !allowed.has(reference));
  if (invalid) throw new Error(`Model cited evidence outside the admitted pack: ${invalid}.`);
}

function makeProposal(input: {
  proposal: ShadowAgentOutput["proposals"][number];
  order: AgentWorkOrder;
  sessionId: string;
  llmRunId: string;
  id: string;
  createdAt: string;
}): ShadowProposalRecord {
  const normalized = {
    action: sanitizeText(input.proposal.action, 2_000),
    rationale: sanitizeText(input.proposal.rationale, 5_000),
    evidenceRefs: Object.freeze([...new Set(input.proposal.evidenceRefs)].sort()),
    expectedImpactMinorClp: input.proposal.expectedImpactMinorClp,
    risk: input.proposal.risk,
  };
  return Object.freeze({
    id: input.id,
    organizationId: input.order.organizationId,
    accountId: input.order.accountId,
    workOrderId: input.order.id,
    sessionId: input.sessionId,
    llmRunId: input.llmRunId,
    agentId: input.order.agentId,
    ...normalized,
    requiresHumanApproval: true,
    status: "pending-approval",
    contentHash: hashJson(normalized),
    createdAt: input.createdAt,
    decidedAt: null,
    decidedBy: null,
  });
}

function assertScope(
  pack: OperationalEvidencePack,
  organizationId: string,
  accountId: string,
): void {
  if (pack.organizationId !== organizationId || pack.accountId !== accountId) {
    throw new Error("Evidence pack scope mismatch.");
  }
}

function clearLease(order: AgentWorkOrder): AgentWorkOrder {
  return Object.freeze({ ...order, leaseOwner: null, leaseUntil: null });
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function sanitizeText(value: string, maximum: number): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

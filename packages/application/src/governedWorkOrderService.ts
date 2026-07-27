import type { AgentWorkOrder, LlmTaskClass, Signal } from "@eauto/domain";
import { assertUsableEvidencePack } from "@eauto/domain";
import { decideWake, getCompanyAgentContract } from "@eauto/agent-kernel";
import type { OperationalIntelligenceRepository } from "./operationalIntelligenceService.js";

export class GovernedWorkOrderService {
  constructor(
    private readonly repository: OperationalIntelligenceRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async enqueue(input: {
    organizationId: string;
    accountId: string;
    objectiveId: string;
    agentId: string;
    capability: string;
    taskClass: LlmTaskClass;
    instruction: string;
    evidencePackId: string;
    signals: readonly Signal[];
    previousSignalsHash?: string;
    cooldownUntil?: string;
    estimatedCostMicrosUsd: number;
    budgetMicrosUsd: number;
    budgetMinorClp: number;
    maximumAttempts: number;
    idempotencyKey: string;
    manual?: boolean;
  }): Promise<Readonly<{ order: AgentWorkOrder; wake: ReturnType<typeof decideWake> }>> {
    const contract = getCompanyAgentContract(input.agentId);
    if (!contract || !contract.active)
      throw new Error(`Unknown or inactive agent ${input.agentId}.`);
    if (!contract.allowedCapabilities.includes(input.capability)) {
      throw new Error(`Capability ${input.capability} is not allowed for ${input.agentId}.`);
    }
    if (contract.forbiddenCapabilities.includes(input.capability)) {
      throw new Error(`Capability ${input.capability} is forbidden for ${input.agentId}.`);
    }
    const pack = await this.repository.getEvidencePack(input.evidencePackId);
    if (!pack) throw new Error(`Evidence pack ${input.evidencePackId} not found.`);
    if (pack.organizationId !== input.organizationId || pack.accountId !== input.accountId) {
      throw new Error("Evidence pack scope mismatch.");
    }
    const now = this.clock.now();
    assertUsableEvidencePack(pack, now.toISOString());
    const availableKinds = new Set(
      pack.documents.flatMap((document) => (document.kind ? [document.kind] : [])),
    );
    const missingKinds = contract.requiredEvidenceKinds.filter((kind) => !availableKinds.has(kind));
    const wake = decideWake({
      signals: input.signals,
      ...(input.previousSignalsHash ? { previousSignalsHash: input.previousSignalsHash } : {}),
      ...(input.cooldownUntil ? { cooldownUntil: input.cooldownUntil } : {}),
      now: now.toISOString(),
      estimatedCost: input.estimatedCostMicrosUsd,
      ...(input.manual === undefined ? {} : { manual: input.manual }),
    });
    const status =
      missingKinds.length > 0 ? "waiting-evidence" : wake.shouldWake ? "queued" : "skipped";
    const order = Object.freeze({
      id: this.ids.next("work-order"),
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      accountId: input.accountId,
      objectiveId: input.objectiveId,
      agentId: input.agentId,
      capability: input.capability,
      taskClass: input.taskClass,
      requestedAction: sanitize(input.instruction, 5_000),
      evidencePackId: input.evidencePackId,
      memoryRefs: Object.freeze([]),
      signalsHash: wake.signalsHash,
      expectedUtility: wake.expectedUtility,
      wakeReason: missingKinds.length > 0 ? "missing-evidence" : wake.reason,
      status,
      budgetMinorClp: validateNonNegative(input.budgetMinorClp, "budgetMinorClp"),
      budgetMicrosUsd: validateNonNegative(input.budgetMicrosUsd, "budgetMicrosUsd"),
      maximumAttempts: validatePositive(input.maximumAttempts, "maximumAttempts"),
      attempts: 0,
      availableAt: now.toISOString(),
      cooldownUntil: input.cooldownUntil ?? null,
      leaseOwner: null,
      leaseUntil: null,
      sessionId: null,
      outputRefs: Object.freeze([]),
      failureReason:
        missingKinds.length > 0 ? `missing-evidence:${missingKinds.sort().join(",")}` : null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: status === "skipped" ? now.toISOString() : null,
    } satisfies AgentWorkOrder);
    return { order: await this.repository.enqueueWorkOrder(order), wake };
  }
}

function sanitize(value: string, maximum: number): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
  if (normalized.length < 3) throw new Error("Work order instruction is too short.");
  return normalized.slice(0, maximum);
}

function validateNonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative.`);
  return value;
}

function validatePositive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

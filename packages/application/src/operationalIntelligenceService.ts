import { createHash } from "node:crypto";
import type {
  AgentWorkOrder,
  ConsultativeMemoryRecord,
  EvidenceDocument,
  EvidenceSubject,
  LlmTaskClass,
  OperationalEvidencePack,
  ShadowProposalRecord,
  ShadowProposalStatus,
  Signal,
} from "@eauto/domain";
import {
  assertUsableEvidencePack,
  decideMemoryAdmission,
  type ShadowAgentOutput,
} from "@eauto/domain";
import { decideWake, type PromptCompilerInput } from "@eauto/agent-kernel";
import type { AgentOsService } from "./agentOsService.js";
import type { ShadowLlmService } from "./llmService.js";

export interface OperationalEvidenceReader {
  read(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{ documents: readonly EvidenceDocument[]; missingInputs: readonly string[] }>
  >;
}

export interface OperationalIntelligenceRepository {
  saveEvidencePack(pack: OperationalEvidencePack): Promise<void>;
  getEvidencePack(id: string): Promise<OperationalEvidencePack | null>;
  listEvidencePacks(accountId: string, limit: number): Promise<readonly OperationalEvidencePack[]>;
  saveMemory(record: ConsultativeMemoryRecord): Promise<void>;
  listMemory(accountId: string, limit: number): Promise<readonly ConsultativeMemoryRecord[]>;
  enqueueWorkOrder(order: AgentWorkOrder): Promise<AgentWorkOrder>;
  getWorkOrder(id: string): Promise<AgentWorkOrder | null>;
  listWorkOrders(accountId: string, limit: number): Promise<readonly AgentWorkOrder[]>;
  leaseWorkOrders(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentWorkOrder[]>;
  updateWorkOrder(order: AgentWorkOrder): Promise<void>;
  saveProposal(proposal: ShadowProposalRecord): Promise<void>;
  listProposals(accountId: string, limit: number): Promise<readonly ShadowProposalRecord[]>;
  decideProposal(input: {
    id: string;
    accountId: string;
    status: Exclude<ShadowProposalStatus, "pending-approval">;
    decidedAt: string;
    decidedBy: string;
  }): Promise<ShadowProposalRecord | null>;
}

export class OperationalIntelligenceService {
  constructor(
    private readonly repository: OperationalIntelligenceRepository,
    private readonly evidenceReader: OperationalEvidenceReader,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async buildEvidencePack(input: {
    organizationId: string;
    accountId: string;
    purpose: string;
    subject: EvidenceSubject;
    maximumAgeMs: number;
  }): Promise<OperationalEvidencePack> {
    const generatedAt = this.clock.now();
    const collected = await this.evidenceReader.read({
      organizationId: input.organizationId,
      accountId: input.accountId,
      subject: input.subject,
      asOf: generatedAt.toISOString(),
      maximumAgeMs: input.maximumAgeMs,
    });
    const expiresAt = new Date(generatedAt.getTime() + input.maximumAgeMs).toISOString();
    const complete =
      collected.documents.length > 0 &&
      collected.missingInputs.length === 0 &&
      collected.documents.every(
        (document) =>
          document.authority !== "advisory" &&
          document.reference.freshness === "fresh" &&
          Date.parse(document.expiresAt) > generatedAt.getTime(),
      );
    const hashInput = {
      organizationId: input.organizationId,
      accountId: input.accountId,
      purpose: input.purpose,
      subject: input.subject,
      documents: collected.documents.map((document) => ({
        id: document.reference.id,
        contentHash: document.reference.contentHash,
        authority: document.authority,
        expiresAt: document.expiresAt,
      })),
      missingInputs: [...collected.missingInputs].sort(),
    };
    const pack = Object.freeze({
      id: this.ids.next("evidence-pack"),
      organizationId: input.organizationId,
      accountId: input.accountId,
      purpose: sanitizeText(input.purpose, 500),
      subject: input.subject,
      generatedAt: generatedAt.toISOString(),
      expiresAt,
      documents: Object.freeze([...collected.documents]),
      complete,
      missingInputs: Object.freeze([...collected.missingInputs]),
      contentHash: hashJson(hashInput),
    } satisfies OperationalEvidencePack);
    await this.repository.saveEvidencePack(pack);
    return pack;
  }

  async saveMemory(input: Omit<ConsultativeMemoryRecord, "id" | "createdAt" | "contentHash">) {
    const now = this.clock.now().toISOString();
    const normalized = {
      organizationId: input.organizationId,
      accountId: input.accountId,
      kind: input.kind,
      content: sanitizeText(input.content, 20_000),
      sourceRefs: Object.freeze([...new Set(input.sourceRefs)].sort()),
      confidence: input.confidence,
      verifiedOutcome: input.verifiedOutcome,
      expiresAt: input.expiresAt,
    };
    if (normalized.sourceRefs.length === 0)
      throw new Error("Memory requires provenance references.");
    if (normalized.kind === "verified-outcome" && !normalized.verifiedOutcome) {
      throw new Error("Verified outcome memory requires a verified outcome receipt.");
    }
    const record = Object.freeze({
      id: this.ids.next("memory"),
      ...normalized,
      createdAt: now,
      contentHash: hashJson(normalized),
    } satisfies ConsultativeMemoryRecord);
    await this.repository.saveMemory(record);
    return record;
  }

  async admittedMemory(input: {
    organizationId: string;
    accountId: string;
    limit?: number;
  }): Promise<readonly ConsultativeMemoryRecord[]> {
    const now = this.clock.now().toISOString();
    const records = await this.repository.listMemory(input.accountId, input.limit ?? 100);
    return Object.freeze(
      records.filter(
        (record) =>
          decideMemoryAdmission({
            record,
            organizationId: input.organizationId,
            accountId: input.accountId,
            now,
            requireVerifiedOutcome: true,
          }).admitted,
      ),
    );
  }

  async enqueueWorkOrder(input: {
    organizationId: string;
    accountId: string;
    objectiveId: string;
    agentId: string;
    taskClass: LlmTaskClass;
    requestedAction: string;
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
    const now = this.clock.now();
    const pack = await this.requirePack(input.evidencePackId);
    assertScope(pack, input.organizationId, input.accountId);
    assertUsableEvidencePack(pack, now.toISOString());
    const wake = decideWake({
      signals: input.signals,
      ...(input.previousSignalsHash ? { previousSignalsHash: input.previousSignalsHash } : {}),
      ...(input.cooldownUntil ? { cooldownUntil: input.cooldownUntil } : {}),
      now: now.toISOString(),
      estimatedCost: input.estimatedCostMicrosUsd,
      ...(input.manual === undefined ? {} : { manual: input.manual }),
    });
    const status = wake.shouldWake ? "queued" : "skipped";
    const order = Object.freeze({
      id: this.ids.next("work-order"),
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      accountId: input.accountId,
      objectiveId: input.objectiveId,
      agentId: input.agentId,
      taskClass: input.taskClass,
      requestedAction: sanitizeText(input.requestedAction, 5_000),
      evidencePackId: input.evidencePackId,
      memoryRefs: Object.freeze([]),
      signalsHash: wake.signalsHash,
      expectedUtility: wake.expectedUtility,
      wakeReason: wake.reason,
      status,
      budgetMinorClp: nonNegativeInteger(input.budgetMinorClp, "budgetMinorClp"),
      budgetMicrosUsd: nonNegativeInteger(input.budgetMicrosUsd, "budgetMicrosUsd"),
      maximumAttempts: positiveInteger(input.maximumAttempts, "maximumAttempts"),
      attempts: 0,
      availableAt: now.toISOString(),
      cooldownUntil: input.cooldownUntil ?? null,
      leaseOwner: null,
      leaseUntil: null,
      sessionId: null,
      outputRefs: Object.freeze([]),
      failureReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: status === "skipped" ? now.toISOString() : null,
    } satisfies AgentWorkOrder);
    return { order: await this.repository.enqueueWorkOrder(order), wake };
  }

  listEvidencePacks(accountId: string, limit = 100) {
    return this.repository.listEvidencePacks(accountId, boundedLimit(limit));
  }

  listWorkOrders(accountId: string, limit = 100) {
    return this.repository.listWorkOrders(accountId, boundedLimit(limit));
  }

  listProposals(accountId: string, limit = 100) {
    return this.repository.listProposals(accountId, boundedLimit(limit));
  }

  decideProposal(input: {
    id: string;
    accountId: string;
    status: Exclude<ShadowProposalStatus, "pending-approval">;
    decidedBy: string;
  }) {
    return this.repository.decideProposal({
      ...input,
      decidedAt: this.clock.now().toISOString(),
    });
  }

  private async requirePack(id: string): Promise<OperationalEvidencePack> {
    const pack = await this.repository.getEvidencePack(id);
    if (!pack) throw new Error(`Evidence pack ${id} not found.`);
    return pack;
  }
}

export class ShadowWorkOrderProcessor {
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
    const pack = await this.repository.getEvidencePack(order.evidencePackId);
    if (!pack) throw new Error("evidence-pack-not-found");
    assertScope(pack, order.organizationId, order.accountId);
    assertUsableEvidencePack(pack, this.clock.now().toISOString());
    const memory = await this.intelligence.admittedMemory({
      organizationId: order.organizationId,
      accountId: order.accountId,
      limit: 100,
    });
    const sessionResult = await this.agentOs.createSession({
      organizationId: order.organizationId,
      accountId: order.accountId,
      objectiveId: order.objectiveId,
      agentId: order.agentId,
      parentSessionId: null,
      requestedAction: order.requestedAction,
      availableEvidenceKinds: Object.freeze([
        ...new Set(pack.documents.map((document) => document.subject)),
      ]),
      evidenceRefs: Object.freeze(pack.documents.map((document) => document.reference.id)),
      autonomy: "ask",
      requestedBudgetMinorClp: order.budgetMinorClp,
      spentTodayMinorClp: 0,
      policyAllowed: true,
      stableContextRefs: Object.freeze(["company-constitution-v1", "company-policy-v1"]),
      volatileContextRefs: Object.freeze([pack.id, ...memory.map((record) => record.id)]),
      idempotencyKey: `work-order:${order.id}`,
      deadlineAt: new Date(
        this.clock.now().getTime() + this.config.sessionDeadlineMs,
      ).toISOString(),
    });
    if (sessionResult.session.status !== "queued") {
      await this.repository.updateWorkOrder(
        Object.freeze({
          ...clearLease(order),
          status:
            sessionResult.session.status === "waiting-evidence"
              ? "waiting-evidence"
              : "waiting-approval",
          sessionId: sessionResult.session.id,
          memoryRefs: Object.freeze(memory.map((record) => record.id)),
          updatedAt: this.clock.now().toISOString(),
        }),
      );
      return;
    }
    const session = await this.agentOs.startSession(sessionResult.session.id);
    const prompt = buildPrompt(pack, memory, order, this.config);
    const result = await this.shadowLlm.run({
      organizationId: order.organizationId,
      accountId: order.accountId,
      agentId: order.agentId,
      sessionId: session.id,
      taskClass: order.taskClass,
      prompt,
      inputSchemaVersion: "work-order-v1",
      outputSchemaVersion: "shadow-output-v1",
      budgetMicrosUsd: order.budgetMicrosUsd,
    });
    if (!result.output || result.run.status !== "completed") {
      throw new Error(result.run.failureReason ?? `llm-run-${result.run.status}`);
    }
    const proposalRefs: string[] = [];
    for (const proposal of result.output.proposals) {
      const record = makeProposal({
        proposal,
        order,
        sessionId: session.id,
        llmRunId: result.run.id,
        id: this.ids.next("proposal"),
        createdAt: this.clock.now().toISOString(),
      });
      await this.repository.saveProposal(record);
      proposalRefs.push(`proposal:${record.id}`);
    }
    const outputRefs = Object.freeze([`llm-run:${result.run.id}`, ...proposalRefs]);
    await this.agentOs.completeSession({
      sessionId: session.id,
      outputRefs,
      spentMinorClp: 0,
    });
    const completedAt = this.clock.now().toISOString();
    await this.repository.updateWorkOrder(
      Object.freeze({
        ...clearLease(order),
        status: "completed",
        sessionId: session.id,
        memoryRefs: Object.freeze(memory.map((record) => record.id)),
        outputRefs,
        completedAt,
        updatedAt: completedAt,
      }),
    );
  }

  private async fail(order: AgentWorkOrder, error: unknown): Promise<void> {
    const attempts = order.attempts;
    const dead = attempts >= order.maximumAttempts;
    const now = this.clock.now();
    const delay = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * 2 ** Math.max(0, attempts - 1),
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
    agentIdentity: JSON.stringify({ agentId: order.agentId }),
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
      requestedAction: order.requestedAction,
      expectedUtility: order.expectedUtility,
    }),
  };
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

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative.`);
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function boundedLimit(value: number): number {
  return Math.min(500, Math.max(1, value));
}

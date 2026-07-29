import { createHash } from "node:crypto";
import type {
  Signal,
  SpecialistDaemonDefinition,
  SpecialistDaemonId,
  SpecialistDaemonRun,
  SpecialistDaemonState,
} from "@eauto/domain";
import { assertSpecialistDaemonCatalog } from "@eauto/domain";
import type { GovernedWorkOrderService } from "./governedWorkOrderService.js";
import type { OperationalIntelligenceService } from "./operationalIntelligenceService.js";

export interface SpecialistDaemonRepository {
  ensureStates(input: {
    organizationId: string;
    accountId: string;
    definitions: readonly SpecialistDaemonDefinition[];
    now: string;
  }): Promise<void>;
  leaseDueStates(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly SpecialistDaemonState[]>;
  saveState(state: SpecialistDaemonState): Promise<void>;
  saveRun(run: SpecialistDaemonRun): Promise<void>;
  listStates(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly SpecialistDaemonState[]>;
  listRuns(input: {
    organizationId: string;
    accountId: string;
    daemonId?: SpecialistDaemonId;
    limit: number;
  }): Promise<readonly SpecialistDaemonRun[]>;
}

export interface SpecialistDaemonSignalProvider {
  readSignals(input: {
    organizationId: string;
    accountId: string;
    definition: SpecialistDaemonDefinition;
    asOf: string;
  }): Promise<readonly Signal[]>;
}

export const SPECIALIST_DAEMON_CATALOG: readonly SpecialistDaemonDefinition[] = Object.freeze([
  daemon(
    "economic-ingestion",
    "economics.read",
    "analysis",
    "economic",
    ["order-snapshot", "cost-evidence"],
    "Reconcile orders and cost evidence; report missing economic inputs.",
  ),
  daemon(
    "unit-economics",
    "economics.read",
    "analysis",
    "economic",
    ["economic-snapshot"],
    "Audit unit economics, contribution margin and capital exposure.",
  ),
  daemon(
    "pricing",
    "proposal.create",
    "planning",
    "economic",
    ["economic-snapshot", "market-evidence"],
    "Prepare pricing proposals that preserve the configured margin floor.",
  ),
  daemon(
    "ads-profitability",
    "ads.read",
    "analysis",
    "economic",
    ["ads-snapshot", "economic-snapshot"],
    "Reconcile direct Product Ads evidence against profitability.",
  ),
  daemon(
    "analytics",
    "analytics.read",
    "analysis",
    "commercial",
    ["analytics-snapshot"],
    "Detect material changes in sales, visits, conversion and anomalies.",
  ),
  daemon(
    "catalog",
    "catalog.read",
    "analysis",
    "catalog",
    ["listing-snapshot"],
    "Audit catalog attributes, duplicates, taxonomy and listing gaps.",
  ),
  daemon(
    "product-research",
    "research.read",
    "analysis",
    "catalog",
    ["market-evidence", "supplier-evidence"],
    "Research bounded product opportunities using current market and supplier evidence.",
  ),
  daemon(
    "listing-retread",
    "catalog.read",
    "planning",
    "catalog",
    ["listing-snapshot", "analytics-snapshot"],
    "Prepare non-executable improvement plans for stagnant listings.",
  ),
  daemon(
    "supplier-manager",
    "supplier.read",
    "analysis",
    "economic",
    ["supplier-evidence"],
    "Audit supplier authority, cost, availability, lead time and concentration.",
  ),
  daemon(
    "inventory-forecast",
    "inventory.read",
    "analysis",
    "commercial",
    ["inventory-snapshot", "order-snapshot"],
    "Forecast stockout and excess inventory from verified evidence.",
  ),
  daemon(
    "acquisition-imports",
    "supplier.read",
    "planning",
    "economic",
    ["supplier-evidence", "landed-cost-evidence"],
    "Evaluate landed cost, logistics and working-capital risk without purchasing.",
  ),
  daemon(
    "sales-service",
    "questions.read",
    "analysis",
    "customer",
    ["customer-operation-snapshot"],
    "Prioritize pending sales and questions without answering automatically.",
  ),
  daemon(
    "claims-reputation",
    "claims.read",
    "analysis",
    "reputation",
    ["customer-operation-snapshot"],
    "Detect claim, return and reputation risks that require owner attention.",
  ),
  daemon(
    "shipping-logistics",
    "shipping.read",
    "analysis",
    "customer",
    ["shipment-snapshot"],
    "Audit shipment SLA, tracking and logistics exceptions.",
  ),
  daemon(
    "creative-studio",
    "content.draft",
    "planning",
    "content",
    ["product-evidence", "brand-policy"],
    "Prepare traceable creative packages; never publish automatically.",
  ),
  daemon(
    "product-ads",
    "ads.read",
    "analysis",
    "economic",
    ["ads-snapshot", "economic-snapshot"],
    "Prepare Product Ads optimization proposals from direct item attribution only.",
  ),
]);
assertSpecialistDaemonCatalog(SPECIALIST_DAEMON_CATALOG);

export class SpecialistDaemonScheduler {
  private readonly definitions: ReadonlyMap<SpecialistDaemonId, SpecialistDaemonDefinition>;

  constructor(
    definitions: readonly SpecialistDaemonDefinition[],
    private readonly repository: SpecialistDaemonRepository,
    private readonly signals: SpecialistDaemonSignalProvider,
    private readonly intelligence: OperationalIntelligenceService,
    private readonly workOrders: GovernedWorkOrderService,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
    private readonly config: Readonly<{ workerId: string; leaseMs: number }>,
  ) {
    assertSpecialistDaemonCatalog(definitions);
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  initialize(input: { organizationId: string; accountId: string }): Promise<void> {
    return this.repository.ensureStates({
      ...input,
      definitions: [...this.definitions.values()],
      now: this.clock.now().toISOString(),
    });
  }

  async runOnce(limit = 16): Promise<
    Readonly<{
      leased: number;
      queued: number;
      skipped: number;
      waitingEvidence: number;
      failed: number;
    }>
  > {
    const now = this.clock.now();
    const states = await this.repository.leaseDueStates({
      owner: this.config.workerId,
      now,
      leaseUntil: new Date(now.getTime() + this.config.leaseMs),
      limit: Math.min(100, positive(limit, "limit")),
    });
    const summary = { leased: states.length, queued: 0, skipped: 0, waitingEvidence: 0, failed: 0 };
    for (const state of states) {
      const outcome = await this.runState(state).catch(async (error: unknown) => {
        await this.recordFailure(state, error);
        return "failed" as const;
      });
      if (outcome === "queued") summary.queued += 1;
      else if (outcome === "skipped") summary.skipped += 1;
      else if (outcome === "waiting-evidence") summary.waitingEvidence += 1;
      else summary.failed += 1;
    }
    return summary;
  }

  listStates(input: { organizationId: string; accountId: string }) {
    return this.repository.listStates(input);
  }

  listRuns(input: {
    organizationId: string;
    accountId: string;
    daemonId?: SpecialistDaemonId;
    limit?: number;
  }) {
    return this.repository.listRuns({
      ...input,
      limit: Math.min(100, positive(input.limit ?? 50, "limit")),
    });
  }

  private async runState(
    state: SpecialistDaemonState,
  ): Promise<"queued" | "skipped" | "waiting-evidence"> {
    const definition = this.definitions.get(state.daemonId);
    if (!definition) throw new Error(`Daemon definition ${state.daemonId} is missing.`);
    if (!state.enabled) {
      await this.completeState(state, definition, "skipped", null, null, "disabled", []);
      return "skipped";
    }
    const startedAt = this.clock.now();
    const signals = await this.signals.readSignals({
      organizationId: state.organizationId,
      accountId: state.accountId,
      definition,
      asOf: startedAt.toISOString(),
    });
    const pack = await this.intelligence.buildEvidencePack({
      organizationId: state.organizationId,
      accountId: state.accountId,
      purpose: `daemon:${definition.id}`,
      subject: definition.evidenceSubject,
      maximumAgeMs: definition.maximumEvidenceAgeMs,
    });
    const missingRequiredKinds = definition.requiredEvidenceKinds.filter(
      (kind) => !pack.documents.some((document) => document.kind === kind),
    );
    if (!pack.complete || missingRequiredKinds.length > 0) {
      const missingInputs = [...new Set([...pack.missingInputs, ...missingRequiredKinds])];
      await this.completeState(
        state,
        definition,
        "waiting-evidence",
        pack.id,
        null,
        `missing-evidence:${missingInputs.join(",")}`,
        signals,
      );
      return "waiting-evidence";
    }
    const result = await this.workOrders.enqueue({
      organizationId: state.organizationId,
      accountId: state.accountId,
      objectiveId: `daemon:${definition.id}`,
      agentId: definition.agentId,
      capability: definition.capability,
      taskClass: definition.taskClass,
      instruction: definition.instruction,
      evidencePackId: pack.id,
      signals,
      ...(state.previousSignalsHash ? { previousSignalsHash: state.previousSignalsHash } : {}),
      estimatedCostMicrosUsd: definition.estimatedCostMicrosUsd,
      budgetMicrosUsd: definition.budgetMicrosUsd,
      budgetMinorClp: definition.budgetMinorClp,
      maximumAttempts: definition.maximumAttempts,
      idempotencyKey: `daemon:${state.organizationId}:${state.accountId}:${definition.id}:${pack.contentHash}`,
    });
    const status = result.order.status === "queued" ? "queued" : "skipped";
    await this.completeState(
      state,
      definition,
      status,
      pack.id,
      result.order.id,
      result.wake.reason,
      signals,
      result.order.signalsHash,
    );
    return status;
  }

  private async completeState(
    state: SpecialistDaemonState,
    definition: SpecialistDaemonDefinition,
    status: "queued" | "skipped" | "waiting-evidence",
    evidencePackId: string | null,
    workOrderId: string | null,
    reason: string,
    signals: readonly Signal[],
    signalsHash?: string,
  ): Promise<void> {
    const completedAt = this.clock.now();
    const nextRunAt = new Date(
      completedAt.getTime() +
        (status === "waiting-evidence" ? definition.retryIntervalMs : definition.successIntervalMs),
    ).toISOString();
    await this.repository.saveState(
      Object.freeze({
        ...state,
        nextRunAt,
        leaseOwner: null,
        leaseUntil: null,
        previousSignalsHash: signalsHash ?? state.previousSignalsHash,
        lastEvidencePackId: evidencePackId,
        lastWorkOrderId: workOrderId,
        lastStatus: status,
        lastError: null,
        lastRunAt: completedAt.toISOString(),
        updatedAt: completedAt.toISOString(),
      }),
    );
    const normalized = Object.freeze({
      organizationId: state.organizationId,
      accountId: state.accountId,
      daemonId: definition.id,
      signals: Object.freeze([...signals]),
      evidencePackId,
      workOrderId,
      status,
      reason,
      startedAt: state.leaseUntil
        ? new Date(Date.parse(state.leaseUntil) - this.config.leaseMs).toISOString()
        : completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    await this.repository.saveRun(
      Object.freeze({
        id: this.ids.next("daemon-run"),
        ...normalized,
        contentHash: hashJson(normalized),
      }),
    );
  }

  private async recordFailure(state: SpecialistDaemonState, error: unknown): Promise<void> {
    const definition = this.definitions.get(state.daemonId);
    if (!definition) throw error;
    const completedAt = this.clock.now();
    const reason = sanitizeError(error);
    await this.repository.saveState(
      Object.freeze({
        ...state,
        nextRunAt: new Date(completedAt.getTime() + definition.retryIntervalMs).toISOString(),
        leaseOwner: null,
        leaseUntil: null,
        lastStatus: "failed",
        lastError: reason,
        lastRunAt: completedAt.toISOString(),
        updatedAt: completedAt.toISOString(),
      }),
    );
    const normalized = Object.freeze({
      organizationId: state.organizationId,
      accountId: state.accountId,
      daemonId: state.daemonId,
      signals: Object.freeze([]),
      evidencePackId: state.lastEvidencePackId,
      workOrderId: state.lastWorkOrderId,
      status: "failed" as const,
      reason,
      startedAt: completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    await this.repository.saveRun(
      Object.freeze({
        id: this.ids.next("daemon-run"),
        ...normalized,
        contentHash: hashJson(normalized),
      }),
    );
  }
}

function daemon(
  id: SpecialistDaemonId,
  capability: string,
  taskClass: SpecialistDaemonDefinition["taskClass"],
  evidenceSubject: SpecialistDaemonDefinition["evidenceSubject"],
  requiredEvidenceKinds: readonly string[],
  instruction: string,
): SpecialistDaemonDefinition {
  return Object.freeze({
    id,
    agentId: id,
    capability,
    taskClass,
    evidenceSubject,
    requiredEvidenceKinds: Object.freeze([...requiredEvidenceKinds]),
    instruction,
    successIntervalMs: 15 * 60_000,
    retryIntervalMs: 60_000,
    maximumEvidenceAgeMs: 15 * 60_000,
    estimatedCostMicrosUsd: 25_000,
    budgetMicrosUsd: 100_000,
    budgetMinorClp: 0,
    maximumAttempts: 5,
  });
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown daemon failure")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

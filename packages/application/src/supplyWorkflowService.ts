import { createHash } from "node:crypto";
import type {
  SupplyWorkflowRequest,
  SupplyWorkflowRun,
  SupplyWorkflowStep,
} from "@eauto/domain";
import { planSupplyWorkflow, supplyWorkflowActionKind } from "@eauto/domain";

export interface SupplyWorkflowRepository {
  saveSupplyWorkflow(run: SupplyWorkflowRun): Promise<SupplyWorkflowRun>;
  getSupplyWorkflow(input: {
    organizationId: string;
    accountId: string;
    id: string;
  }): Promise<SupplyWorkflowRun | null>;
  listSupplyWorkflows(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly SupplyWorkflowRun[]>;
}

export interface SupplyWorkflowEvidenceReader {
  read(input: {
    organizationId: string;
    accountId: string;
    supplierId: string;
    listingId: string | null;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{
      availableKinds: readonly string[];
      evidenceRefs: readonly string[];
      missingInputs: readonly string[];
    }>
  >;
}

export class SupplyWorkflowService {
  constructor(
    private readonly repository: SupplyWorkflowRepository,
    private readonly evidence: SupplyWorkflowEvidenceReader,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async run(request: SupplyWorkflowRequest): Promise<SupplyWorkflowRun> {
    if (request.dryRun !== true) throw new Error("Supply workflows are dry-run only.");
    if (!request.organizationId.trim() || !request.accountId.trim()) {
      throw new Error("Supply workflow requires organization and account scope.");
    }
    if (!request.supplierId.trim()) throw new Error("Supply workflow requires supplierId.");
    if (request.kind !== "supplier.full-scrape" && !request.listingId) {
      throw new Error(`${request.kind} requires listingId.`);
    }
    const now = this.clock.now().toISOString();
    const observed = await this.evidence.read({
      organizationId: request.organizationId,
      accountId: request.accountId,
      supplierId: request.supplierId,
      listingId: request.listingId,
      asOf: now,
      maximumAgeMs: positive(request.parameters.maximumAgeMs, "maximumAgeMs"),
    });
    const availableKinds = new Set(observed.availableKinds);
    const planned = planSupplyWorkflow(request);
    const steps = Object.freeze(
      planned.map((step) => completeStep(step, availableKinds, observed.evidenceRefs)),
    );
    const missingInputs = Object.freeze([
      ...new Set([
        ...observed.missingInputs,
        ...steps.flatMap((step) => step.missingInputs),
        ...validateBusinessParameters(request),
      ]),
    ].sort());
    const ready = missingInputs.length === 0 && steps.every((step) => step.status === "completed");
    const normalized = Object.freeze({
      organizationId: request.organizationId,
      accountId: request.accountId,
      kind: request.kind,
      supplierId: request.supplierId,
      listingId: request.listingId,
      requestedBy: request.requestedBy,
      status: ready ? ("proposed" as const) : ("waiting-evidence" as const),
      dryRun: true as const,
      steps,
      evidenceRefs: Object.freeze([...new Set([...request.evidenceRefs, ...observed.evidenceRefs])].sort()),
      proposedActionKind: ready ? supplyWorkflowActionKind(request.kind) : null,
      proposedActionId: null,
      missingInputs,
      createdAt: now,
      updatedAt: now,
      completedAt: ready ? now : null,
    });
    return this.repository.saveSupplyWorkflow(
      Object.freeze({
        id: this.ids.next("supply-workflow"),
        ...normalized,
        contentHash: hashJson({ request, normalized }),
      }),
    );
  }

  get(input: { organizationId: string; accountId: string; id: string }) {
    return this.repository.getSupplyWorkflow(input);
  }

  list(input: { organizationId: string; accountId: string; limit?: number }) {
    return this.repository.listSupplyWorkflows({
      ...input,
      limit: Math.min(100, positive(input.limit ?? 50, "limit")),
    });
  }
}

function completeStep(
  step: SupplyWorkflowStep,
  availableKinds: ReadonlySet<string>,
  evidenceRefs: readonly string[],
): SupplyWorkflowStep {
  const missingInputs = Object.freeze(
    step.requiredEvidenceKinds.filter((kind) => !availableKinds.has(kind)),
  );
  if (missingInputs.length > 0) {
    return Object.freeze({ ...step, status: "blocked", missingInputs });
  }
  return Object.freeze({
    ...step,
    status: "completed",
    outputRefs: Object.freeze([...new Set(evidenceRefs)].sort()),
    missingInputs,
  });
}

function validateBusinessParameters(request: SupplyWorkflowRequest): readonly string[] {
  const missing: string[] = [];
  if (request.kind === "stock.autopause" && request.parameters.stockFloor === null) {
    missing.push("stock-floor");
  }
  if (request.kind === "stock.sync" && request.parameters.stockCeiling === null) {
    missing.push("stock-ceiling");
  }
  if (request.kind === "purchase.opportunistic") {
    if (request.parameters.maximumPurchaseQuantity === null) missing.push("maximum-purchase-quantity");
    if (request.parameters.maximumUnitCostMinorClp === null) missing.push("maximum-unit-cost");
  }
  return Object.freeze(missing);
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

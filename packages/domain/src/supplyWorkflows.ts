export const SUPPLY_WORKFLOW_KINDS = [
  "supplier.pause",
  "supplier.full-scrape",
  "stock.sync",
  "stock.autopause",
  "purchase.opportunistic",
] as const;
export type SupplyWorkflowKind = (typeof SUPPLY_WORKFLOW_KINDS)[number];

export const SUPPLY_WORKFLOW_STATUSES = [
  "draft",
  "ready",
  "waiting-evidence",
  "proposed",
  "completed",
  "failed",
] as const;
export type SupplyWorkflowStatus = (typeof SUPPLY_WORKFLOW_STATUSES)[number];

export type SupplyWorkflowRequest = Readonly<{
  organizationId: string;
  accountId: string;
  kind: SupplyWorkflowKind;
  supplierId: string;
  listingId: string | null;
  requestedBy: string;
  parameters: Readonly<{
    maximumAgeMs: number;
    stockFloor: number | null;
    stockCeiling: number | null;
    maximumPurchaseQuantity: number | null;
    maximumUnitCostMinorClp: number | null;
    reason: string;
  }>;
  evidenceRefs: readonly string[];
  dryRun: true;
  idempotencyKey: string;
}>;

export type SupplyWorkflowStep = Readonly<{
  id: string;
  sequence: number;
  kind: "read" | "compare" | "propose" | "stop";
  description: string;
  requiredEvidenceKinds: readonly string[];
  status: "pending" | "ready" | "blocked" | "completed";
  outputRefs: readonly string[];
  missingInputs: readonly string[];
}>;

export type SupplyWorkflowRun = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  kind: SupplyWorkflowKind;
  supplierId: string;
  listingId: string | null;
  requestedBy: string;
  status: SupplyWorkflowStatus;
  dryRun: true;
  steps: readonly SupplyWorkflowStep[];
  evidenceRefs: readonly string[];
  proposedActionKind: string | null;
  proposedActionId: string | null;
  missingInputs: readonly string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  contentHash: string;
}>;

export function planSupplyWorkflow(input: SupplyWorkflowRequest): readonly SupplyWorkflowStep[] {
  const common = Object.freeze([
    step(1, "read", "Load current supplier evidence and authority.", ["supplier-evidence"]),
    step(2, "read", "Load current listing, stock and economic evidence.", [
      "listing-snapshot",
      "inventory-snapshot",
      "economic-snapshot",
    ]),
  ]);
  const specific: readonly SupplyWorkflowStep[] =
    input.kind === "supplier.pause"
      ? Object.freeze([
          step(3, "compare", "Confirm supplier evidence is stale, unavailable or policy-blocked.", [
            "supplier-evidence",
          ]),
          step(4, "propose", "Prepare a governed supplier pause proposal.", ["policy-version"]),
        ])
      : input.kind === "supplier.full-scrape"
        ? Object.freeze([
            step(
              3,
              "compare",
              "Determine whether mirror coverage or freshness requires a full scan.",
              ["supplier-evidence"],
            ),
            step(4, "propose", "Queue a bounded full catalog acquisition work order.", [
              "policy-version",
            ]),
          ])
        : input.kind === "stock.sync"
          ? Object.freeze([
              step(3, "compare", "Compare authoritative supplier stock with marketplace stock.", [
                "supplier-evidence",
                "inventory-snapshot",
              ]),
              step(4, "propose", "Prepare an exact stock synchronization proposal.", [
                "policy-version",
              ]),
            ])
          : input.kind === "stock.autopause"
            ? Object.freeze([
                step(3, "compare", "Confirm supplier stock is below the configured safe floor.", [
                  "supplier-evidence",
                  "inventory-snapshot",
                ]),
                step(4, "propose", "Prepare a governed listing pause proposal.", [
                  "policy-version",
                ]),
              ])
            : Object.freeze([
                step(3, "compare", "Verify opportunity margin, stock and purchase caps.", [
                  "supplier-evidence",
                  "economic-snapshot",
                ]),
                step(4, "propose", "Prepare a non-executable purchase opportunity proposal.", [
                  "policy-version",
                ]),
              ]);
  return Object.freeze([...common, ...specific]);
}

export function supplyWorkflowActionKind(kind: SupplyWorkflowKind): string {
  if (kind === "supplier.pause") return "supplier.pause";
  if (kind === "supplier.full-scrape") return "supplier.catalog.refresh";
  if (kind === "stock.sync") return "listing.stock.update";
  if (kind === "stock.autopause") return "listing.pause";
  return "supplier.purchase.propose";
}

function step(
  sequence: number,
  kind: SupplyWorkflowStep["kind"],
  description: string,
  requiredEvidenceKinds: readonly string[],
): SupplyWorkflowStep {
  return Object.freeze({
    id: `step-${sequence}`,
    sequence,
    kind,
    description,
    requiredEvidenceKinds: Object.freeze([...requiredEvidenceKinds]),
    status: "pending",
    outputRefs: Object.freeze([]),
    missingInputs: Object.freeze([]),
  });
}

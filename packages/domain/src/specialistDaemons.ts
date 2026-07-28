import type { LlmTaskClass } from "./llm.js";
import type { EvidenceSubject, Signal } from "./operationalIntelligence.js";

export const SPECIALIST_DAEMON_IDS = [
  "economic-ingestion",
  "unit-economics",
  "pricing",
  "ads-profitability",
  "analytics",
  "catalog",
  "product-research",
  "listing-retread",
  "supplier-manager",
  "inventory-forecast",
  "acquisition-imports",
  "sales-service",
  "claims-reputation",
  "shipping-logistics",
  "creative-studio",
  "product-ads",
] as const;
export type SpecialistDaemonId = (typeof SPECIALIST_DAEMON_IDS)[number];

export type SpecialistDaemonDefinition = Readonly<{
  id: SpecialistDaemonId;
  agentId: SpecialistDaemonId;
  capability: string;
  taskClass: LlmTaskClass;
  evidenceSubject: EvidenceSubject;
  requiredEvidenceKinds: readonly string[];
  instruction: string;
  successIntervalMs: number;
  retryIntervalMs: number;
  maximumEvidenceAgeMs: number;
  estimatedCostMicrosUsd: number;
  budgetMicrosUsd: number;
  budgetMinorClp: number;
  maximumAttempts: number;
}>;

export type SpecialistDaemonState = Readonly<{
  organizationId: string;
  accountId: string;
  daemonId: SpecialistDaemonId;
  enabled: boolean;
  nextRunAt: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  previousSignalsHash: string | null;
  lastEvidencePackId: string | null;
  lastWorkOrderId: string | null;
  lastStatus: "never" | "queued" | "skipped" | "waiting-evidence" | "failed";
  lastError: string | null;
  lastRunAt: string | null;
  updatedAt: string;
}>;

export type SpecialistDaemonRun = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  daemonId: SpecialistDaemonId;
  signals: readonly Signal[];
  evidencePackId: string | null;
  workOrderId: string | null;
  status: "queued" | "skipped" | "waiting-evidence" | "failed";
  reason: string;
  startedAt: string;
  completedAt: string;
  contentHash: string;
}>;

export function assertSpecialistDaemonCatalog(
  definitions: readonly SpecialistDaemonDefinition[],
): void {
  const ids = new Set(definitions.map((definition) => definition.id));
  if (definitions.length !== SPECIALIST_DAEMON_IDS.length || ids.size !== definitions.length) {
    throw new Error("Specialist daemon catalog must contain exactly sixteen unique definitions.");
  }
  for (const id of SPECIALIST_DAEMON_IDS) {
    if (!ids.has(id)) throw new Error(`Specialist daemon catalog is missing ${id}.`);
  }
  for (const definition of definitions) {
    if (definition.agentId !== definition.id) {
      throw new Error(`Daemon ${definition.id} must reuse the matching Agent OS contract.`);
    }
    if (definition.successIntervalMs < 60_000 || definition.retryIntervalMs < 1_000) {
      throw new Error(`Daemon ${definition.id} uses an unsafe scheduling interval.`);
    }
    if (definition.maximumEvidenceAgeMs < 60_000) {
      throw new Error(`Daemon ${definition.id} requires a positive evidence freshness window.`);
    }
  }
}

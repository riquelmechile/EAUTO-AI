import type { EconomicCostKind, ProfitabilitySnapshot } from "@eauto/domain";
import type { ProfitEngineService } from "./profitEngineService.js";

export type EconomicStatusReport = Readonly<{
  organizationId: string;
  accountId: string;
  listingCount: number;
  policyCount: number;
  costObservationCount: number;
  completeSnapshotCount: number;
  incompleteSnapshotCount: number;
  latestCalculatedAt: string | null;
}>;

export type EconomicCoverageRow = Readonly<{
  listingId: string;
  observedCostKinds: readonly EconomicCostKind[];
  missingRequiredInputs: readonly string[];
  latestStatus: ProfitabilitySnapshot["status"] | null;
  latestCalculatedAt: string | null;
}>;

export type EconomicEvidenceRow = Readonly<{
  listingId: string;
  variableRateEvidenceId: string | null;
  costEvidence: readonly Readonly<{
    kind: EconomicCostKind;
    evidenceId: string;
    source: string;
    observedAt: string;
    contentHash: string;
  }>[];
  latestSnapshot: ProfitabilitySnapshot | null;
}>;

export interface EconomicOperationsRepository {
  listEconomicListingIds(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly string[]>;
  economicStatus(input: {
    organizationId: string;
    accountId: string;
  }): Promise<EconomicStatusReport>;
  economicCoverage(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly EconomicCoverageRow[]>;
  economicEvidence(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<EconomicEvidenceRow | null>;
  latestProfitability(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<ProfitabilitySnapshot | null>;
}

export class EconomicOperationsService {
  constructor(
    private readonly repository: EconomicOperationsRepository,
    private readonly profitEngine: ProfitEngineService,
  ) {}

  async ingest(input: {
    organizationId: string;
    accountId: string;
    listingId?: string;
    limit?: number;
  }): Promise<
    Readonly<{
      attempted: number;
      completed: number;
      incomplete: number;
      failed: readonly Readonly<{ listingId: string; reason: string }>[];
      snapshots: readonly ProfitabilitySnapshot[];
    }>
  > {
    const listingIds = input.listingId
      ? Object.freeze([input.listingId])
      : await this.repository.listEconomicListingIds({
          organizationId: input.organizationId,
          accountId: input.accountId,
          limit: Math.min(10_000, positive(input.limit ?? 1_000, "limit")),
        });
    const snapshots: ProfitabilitySnapshot[] = [];
    const failed: Readonly<{ listingId: string; reason: string }>[] = [];
    for (const listingId of listingIds) {
      try {
        snapshots.push(await this.profitEngine.auditListing(input.accountId, listingId));
      } catch (error) {
        failed.push(Object.freeze({ listingId, reason: sanitizeError(error) }));
      }
    }
    return Object.freeze({
      attempted: listingIds.length,
      completed: snapshots.filter((snapshot) => snapshot.status !== "incomplete").length,
      incomplete: snapshots.filter((snapshot) => snapshot.status === "incomplete").length,
      failed: Object.freeze(failed),
      snapshots: Object.freeze(snapshots),
    });
  }

  status(input: { organizationId: string; accountId: string }) {
    return this.repository.economicStatus(input);
  }

  coverage(input: { organizationId: string; accountId: string; limit?: number }) {
    return this.repository.economicCoverage({
      ...input,
      limit: Math.min(10_000, positive(input.limit ?? 1_000, "limit")),
    });
  }

  async missing(input: { organizationId: string; accountId: string; limit?: number }) {
    const coverage = await this.coverage(input);
    return Object.freeze(coverage.filter((row) => row.missingRequiredInputs.length > 0));
  }

  inspectEvidence(input: { organizationId: string; accountId: string; listingId: string }) {
    return this.repository.economicEvidence(input);
  }

  async reconcile(input: {
    organizationId: string;
    accountId: string;
    listingId?: string;
    limit?: number;
  }): Promise<
    readonly Readonly<{
      listingId: string;
      beforeStatus: ProfitabilitySnapshot["status"] | null;
      afterStatus: ProfitabilitySnapshot["status"] | null;
      changed: boolean;
      failureReason: string | null;
    }>[]
  > {
    const listingIds = input.listingId
      ? Object.freeze([input.listingId])
      : await this.repository.listEconomicListingIds({
          organizationId: input.organizationId,
          accountId: input.accountId,
          limit: Math.min(10_000, positive(input.limit ?? 1_000, "limit")),
        });
    const reconciled: Readonly<{
      listingId: string;
      beforeStatus: ProfitabilitySnapshot["status"] | null;
      afterStatus: ProfitabilitySnapshot["status"] | null;
      changed: boolean;
      failureReason: string | null;
    }>[] = [];
    for (const listingId of listingIds) {
      const before = await this.repository.latestProfitability({ ...input, listingId });
      try {
        const after = await this.profitEngine.auditListing(input.accountId, listingId);
        reconciled.push(
          Object.freeze({
            listingId,
            beforeStatus: before?.status ?? null,
            afterStatus: after.status,
            changed: JSON.stringify(before) !== JSON.stringify(after),
            failureReason: null,
          }),
        );
      } catch (error) {
        reconciled.push(
          Object.freeze({
            listingId,
            beforeStatus: before?.status ?? null,
            afterStatus: null,
            changed: false,
            failureReason: sanitizeError(error),
          }),
        );
      }
    }
    return Object.freeze(reconciled);
  }
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown economic operation failure")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

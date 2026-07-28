import type { SupplierStockPolicy } from "@eauto/domain";
import type { SupplierStockService } from "./supplierStockService.js";

export type SupplierStockAuditCandidate = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  supplierSourceId: string;
  policy: SupplierStockPolicy;
}>;

export type ForLeasingSupplierStockCandidates = {
  claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly SupplierStockAuditCandidate[]>;
  complete(input: {
    candidate: SupplierStockAuditCandidate;
    owner: string;
    nextAuditAt: string;
  }): Promise<void>;
  fail(input: {
    candidate: SupplierStockAuditCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void>;
};

export type SupplierStockAuditDaemonOptions = Readonly<{
  workerId: string;
  leaseMs: number;
  successIntervalMs: number;
  retryIntervalMs: number;
  now(): Date;
}>;

export class SupplierStockAuditDaemon {
  constructor(
    private readonly stock: SupplierStockService,
    private readonly candidates: ForLeasingSupplierStockCandidates,
    private readonly options: SupplierStockAuditDaemonOptions,
  ) {}

  async runOnce(limit: number): Promise<
    Readonly<{
      leased: number;
      evaluated: number;
      proposals: number;
      failed: number;
    }>
  > {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Supplier stock audit limit must be a positive safe integer.");
    }
    const startedAt = this.options.now();
    const leased = await this.candidates.claim({
      owner: this.options.workerId,
      now: startedAt.toISOString(),
      leaseUntil: new Date(startedAt.getTime() + this.options.leaseMs).toISOString(),
      limit,
    });
    let evaluated = 0;
    let proposals = 0;
    let failed = 0;

    for (const candidate of leased) {
      try {
        const assessment = await this.stock.evaluateListing(
          candidate.accountId,
          candidate.listingId,
          candidate.supplierSourceId,
          candidate.policy,
        );
        await this.candidates.complete({
          candidate,
          owner: this.options.workerId,
          nextAuditAt: new Date(
            this.options.now().getTime() + this.options.successIntervalMs,
          ).toISOString(),
        });
        evaluated += 1;
        if (assessment.availabilityProposal) proposals += 1;
      } catch (error) {
        failed += 1;
        await this.candidates.fail({
          candidate,
          owner: this.options.workerId,
          retryAt: new Date(
            this.options.now().getTime() + this.options.retryIntervalMs,
          ).toISOString(),
          error: sanitizeError(error),
        });
      }
    }

    return Object.freeze({ leased: leased.length, evaluated, proposals, failed });
  }
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown supplier stock audit error")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

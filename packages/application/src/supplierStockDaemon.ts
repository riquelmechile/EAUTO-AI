import type { SupplierStockPolicy } from "@eauto/domain";
import type { SupplierStockService } from "./supplierStockService.js";

export type SupplierStockCandidate = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  policy: SupplierStockPolicy;
}>;

export type ForLeasingSupplierStockCandidates = {
  claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly SupplierStockCandidate[]>;
  complete(input: {
    candidate: SupplierStockCandidate;
    owner: string;
    nextEvaluationAt: string;
  }): Promise<void>;
  fail(input: {
    candidate: SupplierStockCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void>;
};

export type SupplierStockDaemonOptions = Readonly<{
  workerId: string;
  leaseMs: number;
  successIntervalMs: number;
  retryIntervalMs: number;
  now(): Date;
}>;

export class SupplierStockDaemon {
  constructor(
    private readonly service: SupplierStockService,
    private readonly candidates: ForLeasingSupplierStockCandidates,
    private readonly options: SupplierStockDaemonOptions,
  ) {}

  async runOnce(limit: number): Promise<
    Readonly<{
      leased: number;
      evaluated: number;
      proposals: number;
      reaudits: number;
      failed: number;
    }>
  > {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Supplier stock daemon limit must be a positive safe integer.");
    }
    const now = this.options.now();
    const leased = await this.candidates.claim({
      owner: this.options.workerId,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + this.options.leaseMs).toISOString(),
      limit,
    });
    let evaluated = 0;
    let proposals = 0;
    let reaudits = 0;
    let failed = 0;

    for (const candidate of leased) {
      try {
        const assessment = await this.service.evaluateListing(
          candidate.accountId,
          candidate.listingId,
          candidate.policy,
        );
        evaluated += 1;
        if (assessment.availabilityProposal) proposals += 1;
        if (assessment.signals.some((signal) => signal.kind === "margin.reaudit-required")) {
          reaudits += 1;
        }
        await this.candidates.complete({
          candidate,
          owner: this.options.workerId,
          nextEvaluationAt: new Date(
            this.options.now().getTime() + this.options.successIntervalMs,
          ).toISOString(),
        });
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

    return Object.freeze({ leased: leased.length, evaluated, proposals, reaudits, failed });
  }
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown supplier stock error")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

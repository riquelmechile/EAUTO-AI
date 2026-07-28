import type { ProfitabilitySnapshot } from "@eauto/domain";
import { ProfitEngineService } from "./profitEngineService.js";

export type MarginAuditCandidate = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
}>;

export type MarginAuditSeverity = "none" | "warning" | "critical" | "blocked";

export type MarginAuditFinding = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  status: ProfitabilitySnapshot["status"];
  severity: MarginAuditSeverity;
  observedAt: string;
  snapshot: ProfitabilitySnapshot;
}>;

export type ForLeasingMarginAuditCandidates = {
  claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly MarginAuditCandidate[]>;
  complete(input: {
    candidate: MarginAuditCandidate;
    owner: string;
    nextAuditAt: string;
  }): Promise<void>;
  fail(input: {
    candidate: MarginAuditCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void>;
};

export type ForSavingMarginAuditFindings = {
  save(finding: MarginAuditFinding): Promise<void>;
};

export type MarginAuditDaemonOptions = Readonly<{
  workerId: string;
  leaseMs: number;
  successIntervalMs: number;
  retryIntervalMs: number;
  now(): Date;
}>;

export class MarginAuditDaemon {
  constructor(
    private readonly profitEngine: ProfitEngineService,
    private readonly candidates: ForLeasingMarginAuditCandidates,
    private readonly findings: ForSavingMarginAuditFindings,
    private readonly options: MarginAuditDaemonOptions,
  ) {}

  async runOnce(limit: number): Promise<Readonly<{
    leased: number;
    audited: number;
    findings: number;
    failed: number;
  }>> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Margin audit limit must be a positive safe integer.");
    }
    const now = this.options.now();
    const leased = await this.candidates.claim({
      owner: this.options.workerId,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + this.options.leaseMs).toISOString(),
      limit,
    });
    let audited = 0;
    let findingCount = 0;
    let failed = 0;

    for (const candidate of leased) {
      try {
        const snapshot = await this.profitEngine.auditListing(
          candidate.accountId,
          candidate.listingId,
        );
        const finding = createMarginAuditFinding(candidate, snapshot, this.options.now().toISOString());
        await this.findings.save(finding);
        await this.candidates.complete({
          candidate,
          owner: this.options.workerId,
          nextAuditAt: new Date(
            this.options.now().getTime() + this.options.successIntervalMs,
          ).toISOString(),
        });
        audited += 1;
        if (finding.severity !== "none") findingCount += 1;
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

    return Object.freeze({ leased: leased.length, audited, findings: findingCount, failed });
  }
}

export function createMarginAuditFinding(
  candidate: MarginAuditCandidate,
  snapshot: ProfitabilitySnapshot,
  observedAt: string,
): MarginAuditFinding {
  if (snapshot.accountId !== candidate.accountId || snapshot.listingId !== candidate.listingId) {
    throw new Error("Profitability snapshot is outside the leased margin-audit scope.");
  }
  const severity: MarginAuditSeverity =
    snapshot.status === "incomplete"
      ? "blocked"
      : snapshot.status === "loss"
        ? "critical"
        : snapshot.status === "below-floor"
          ? "warning"
          : "none";
  return Object.freeze({
    organizationId: candidate.organizationId,
    accountId: candidate.accountId,
    listingId: candidate.listingId,
    status: snapshot.status,
    severity,
    observedAt,
    snapshot,
  });
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown margin audit error")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

import { createHash } from "node:crypto";
import type {
  AccountBrainDimension,
  AccountBrainDimensionState,
  AccountBrainFinding,
  AccountBrainSnapshot,
  SemanticMemorySearchResult,
} from "@eauto/domain";
import {
  ACCOUNT_BRAIN_DIMENSIONS,
  calculateAccountBrainScore,
  deriveAccountBrainPriorities,
} from "@eauto/domain";

export interface AccountBrainRepository {
  saveAccountBrain(snapshot: AccountBrainSnapshot): Promise<void>;
  latestAccountBrain(input: {
    organizationId: string;
    accountId: string;
  }): Promise<AccountBrainSnapshot | null>;
}

export interface AccountBrainSource {
  readDimension(input: {
    organizationId: string;
    accountId: string;
    dimension: AccountBrainDimension;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{
      scoreBps: number | null;
      evidenceRefs: readonly string[];
      missingInputs: readonly string[];
      findings: readonly Omit<AccountBrainFinding, "id" | "dimension" | "memoryRefs">[];
    }>
  >;
  retrieveMemory(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit: number;
  }): Promise<readonly SemanticMemorySearchResult[]>;
}

export class AccountBrainService {
  constructor(
    private readonly repository: AccountBrainRepository,
    private readonly source: AccountBrainSource,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async rebuild(input: {
    organizationId: string;
    accountId: string;
    maximumAgeMs: number;
  }): Promise<AccountBrainSnapshot> {
    if (!input.organizationId.trim() || !input.accountId.trim()) {
      throw new Error("Account Brain requires organization and account scope.");
    }
    if (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs < 60_000) {
      throw new Error("Account Brain maximumAgeMs must be at least one minute.");
    }
    const generatedAt = this.clock.now().toISOString();
    const dimensions: AccountBrainDimensionState[] = [];
    for (const dimension of ACCOUNT_BRAIN_DIMENSIONS) {
      const [read, memory] = await Promise.all([
        this.source.readDimension({
          organizationId: input.organizationId,
          accountId: input.accountId,
          dimension,
          asOf: generatedAt,
          maximumAgeMs: input.maximumAgeMs,
        }),
        this.source.retrieveMemory({
          organizationId: input.organizationId,
          accountId: input.accountId,
          query: dimension,
          limit: 5,
        }),
      ]);
      const memoryRefs = Object.freeze(memory.map((result) => result.entry.id));
      const findings = Object.freeze(
        read.findings.map((finding) =>
          Object.freeze({
            id: this.ids.next("brain-finding"),
            dimension,
            ...finding,
            evidenceRefs: Object.freeze([...finding.evidenceRefs]),
            memoryRefs,
          }),
        ),
      );
      dimensions.push(
        Object.freeze({
          dimension,
          status: deriveStatus(read.scoreBps, read.missingInputs, findings),
          scoreBps: read.scoreBps,
          evidenceRefs: Object.freeze([...new Set(read.evidenceRefs)].sort()),
          memoryRefs,
          missingInputs: Object.freeze([...new Set(read.missingInputs)].sort()),
          findings,
        }),
      );
    }
    const evidenceRefs = Object.freeze(
      [...new Set(dimensions.flatMap((dimension) => dimension.evidenceRefs))].sort(),
    );
    const memoryRefs = Object.freeze(
      [...new Set(dimensions.flatMap((dimension) => dimension.memoryRefs))].sort(),
    );
    const missingInputs = Object.freeze(
      [...new Set(dimensions.flatMap((dimension) => dimension.missingInputs))].sort(),
    );
    const normalized = Object.freeze({
      organizationId: input.organizationId,
      accountId: input.accountId,
      generatedAt,
      asOf: generatedAt,
      complete: missingInputs.length === 0 && evidenceRefs.length > 0,
      overallScoreBps: calculateAccountBrainScore(dimensions),
      dimensions: Object.freeze(dimensions),
      strategicPriorities: deriveAccountBrainPriorities(dimensions),
      evidenceRefs,
      memoryRefs,
      missingInputs,
    });
    const snapshot = Object.freeze({
      id: this.ids.next("account-brain"),
      ...normalized,
      contentHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    } satisfies AccountBrainSnapshot);
    await this.repository.saveAccountBrain(snapshot);
    return snapshot;
  }

  latest(input: { organizationId: string; accountId: string }) {
    return this.repository.latestAccountBrain(input);
  }
}

function deriveStatus(
  scoreBps: number | null,
  missingInputs: readonly string[],
  findings: readonly AccountBrainFinding[],
): AccountBrainDimensionState["status"] {
  if (missingInputs.length > 0 || scoreBps === null) return "insufficient-evidence";
  if (findings.some((finding) => finding.severity === "critical") || scoreBps < 4_000) {
    return "critical";
  }
  if (findings.some((finding) => finding.severity === "warning") || scoreBps < 7_000) {
    return "attention";
  }
  return "healthy";
}

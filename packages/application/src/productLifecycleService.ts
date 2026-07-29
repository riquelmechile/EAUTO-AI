import { createHash } from "node:crypto";
import type {
  ProductLifecycleAssessment,
  ProductLifecycleInput,
  ProductLifecycleState,
} from "@eauto/domain";
import { classifyProductLifecycle } from "@eauto/domain";

export interface ProductLifecycleRepository {
  saveProductLifecycle(assessment: ProductLifecycleAssessment): Promise<void>;
  latestProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<ProductLifecycleAssessment | null>;
  listProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    state?: ProductLifecycleState;
    limit: number;
  }): Promise<readonly ProductLifecycleAssessment[]>;
}

export interface ProductLifecycleSource {
  readLifecycleInput(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
    asOf: string;
  }): Promise<Omit<ProductLifecycleInput, "organizationId" | "accountId" | "listingId" | "asOf">>;
  listListingIds(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly string[]>;
}

export class ProductLifecycleService {
  constructor(
    private readonly repository: ProductLifecycleRepository,
    private readonly source: ProductLifecycleSource,
    private readonly clock: { now(): Date },
  ) {}

  async assess(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<ProductLifecycleAssessment> {
    const asOf = this.clock.now().toISOString();
    const observed = await this.source.readLifecycleInput({ ...input, asOf });
    const classification = classifyProductLifecycle({ ...input, asOf, ...observed });
    const normalized = Object.freeze({
      organizationId: input.organizationId,
      accountId: input.accountId,
      listingId: input.listingId,
      state: classification.state,
      confidence: classification.confidence,
      reasons: classification.reasons,
      evidenceRefs: Object.freeze([...new Set(observed.evidenceRefs)].sort()),
      missingInputs: classification.missingInputs,
      assessedAt: asOf,
    });
    const assessment = Object.freeze({
      ...normalized,
      contentHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    } satisfies ProductLifecycleAssessment);
    await this.repository.saveProductLifecycle(assessment);
    return assessment;
  }

  async assessPortfolio(input: {
    organizationId: string;
    accountId: string;
    limit?: number;
  }): Promise<readonly ProductLifecycleAssessment[]> {
    const listingIds = await this.source.listListingIds({
      organizationId: input.organizationId,
      accountId: input.accountId,
      limit: Math.min(1_000, positive(input.limit ?? 500, "limit")),
    });
    const results: ProductLifecycleAssessment[] = [];
    for (const listingId of listingIds) {
      results.push(await this.assess({ ...input, listingId }));
    }
    return Object.freeze(results);
  }

  latest(input: { organizationId: string; accountId: string; listingId: string }) {
    return this.repository.latestProductLifecycle(input);
  }

  list(input: {
    organizationId: string;
    accountId: string;
    state?: ProductLifecycleState;
    limit?: number;
  }) {
    return this.repository.listProductLifecycle({
      ...input,
      limit: Math.min(1_000, positive(input.limit ?? 100, "limit")),
    });
  }
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

import type {
  MercadoLibreCategoryAttributesContract,
  MercadoLibreCategoryContract,
  MercadoLibreTaxonomyEvidence,
} from "@eauto/domain";
import type { ForReadingMercadoLibreTaxonomy } from "./mercadoLibreTaxonomyPreflightService.js";

export type MercadoLibreTaxonomyScope = Readonly<{
  organizationId: string;
  accountId: string;
  categoryId: string;
}>;

export type ForPersistingMercadoLibreTaxonomySnapshots = Readonly<{
  saveCategory(
    input: MercadoLibreTaxonomyScope & Readonly<{ snapshot: MercadoLibreCategoryContract }>,
  ): Promise<void>;
  saveCategoryAttributes(
    input: MercadoLibreTaxonomyScope &
      Readonly<{ snapshot: MercadoLibreCategoryAttributesContract }>,
  ): Promise<void>;
}>;

export type MercadoLibreTaxonomySnapshotStore = ForReadingMercadoLibreTaxonomy &
  ForPersistingMercadoLibreTaxonomySnapshots;

export class FreshMercadoLibreTaxonomyReader implements ForReadingMercadoLibreTaxonomy {
  private readonly categoryRefreshes = new Map<
    string,
    Promise<MercadoLibreCategoryContract | null>
  >();
  private readonly attributeRefreshes = new Map<
    string,
    Promise<MercadoLibreCategoryAttributesContract | null>
  >();

  constructor(
    private readonly store: MercadoLibreTaxonomySnapshotStore,
    private readonly source: ForReadingMercadoLibreTaxonomy,
    private readonly maximumAgeMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) {
      throw new Error("MercadoLibre taxonomy maximumAgeMs must be a non-negative safe integer.");
    }
  }

  async getCategory(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryContract | null> {
    const snapshot = await this.store.getCategory(input);
    if (snapshot && evidenceIsFresh(snapshot.evidence, this.now(), this.maximumAgeMs)) {
      return snapshot;
    }
    return this.refreshCategory(input);
  }

  async getCategoryAttributes(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryAttributesContract | null> {
    const snapshot = await this.store.getCategoryAttributes(input);
    if (snapshot && evidenceIsFresh(snapshot.evidence, this.now(), this.maximumAgeMs)) {
      return snapshot;
    }
    return this.refreshCategoryAttributes(input);
  }

  private refreshCategory(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryContract | null> {
    const key = scopedKey("category", input);
    const existing = this.categoryRefreshes.get(key);
    if (existing) return existing;
    const refresh = this.loadAndSaveCategory(input).finally(() => {
      if (this.categoryRefreshes.get(key) === refresh) this.categoryRefreshes.delete(key);
    });
    this.categoryRefreshes.set(key, refresh);
    return refresh;
  }

  private refreshCategoryAttributes(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryAttributesContract | null> {
    const key = scopedKey("attributes", input);
    const existing = this.attributeRefreshes.get(key);
    if (existing) return existing;
    const refresh = this.loadAndSaveCategoryAttributes(input).finally(() => {
      if (this.attributeRefreshes.get(key) === refresh) this.attributeRefreshes.delete(key);
    });
    this.attributeRefreshes.set(key, refresh);
    return refresh;
  }

  private async loadAndSaveCategory(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryContract | null> {
    const snapshot = await this.source.getCategory(input);
    if (!snapshot) return null;
    if (snapshot.id !== input.categoryId || snapshot.siteId !== "MLC") {
      throw new Error("MercadoLibre taxonomy source returned a category outside the requested scope.");
    }
    await this.store.saveCategory({ ...input, snapshot });
    return snapshot;
  }

  private async loadAndSaveCategoryAttributes(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryAttributesContract | null> {
    const snapshot = await this.source.getCategoryAttributes(input);
    if (!snapshot) return null;
    if (snapshot.categoryId !== input.categoryId) {
      throw new Error(
        "MercadoLibre taxonomy source returned attributes outside the requested category.",
      );
    }
    await this.store.saveCategoryAttributes({ ...input, snapshot });
    return snapshot;
  }
}

export function evidenceIsFresh(
  evidence: MercadoLibreTaxonomyEvidence,
  now: Date,
  maximumAgeMs: number,
): boolean {
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) return false;
  const observedAt = new Date(evidence.observedAt);
  if (Number.isNaN(observedAt.getTime()) || Number.isNaN(now.getTime())) return false;
  const ageMs = now.getTime() - observedAt.getTime();
  return ageMs >= 0 && ageMs <= maximumAgeMs;
}

function scopedKey(kind: "category" | "attributes", input: MercadoLibreTaxonomyScope): string {
  return JSON.stringify([kind, input.organizationId, input.accountId, input.categoryId]);
}

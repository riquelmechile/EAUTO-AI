import { describe, expect, it, vi } from "vitest";
import {
  FreshMercadoLibreTaxonomyReader,
  evidenceIsFresh,
  type ForReadingMercadoLibreTaxonomy,
  type MercadoLibreTaxonomyScope,
  type MercadoLibreTaxonomySnapshotStore,
} from "@eauto/application";
import type {
  MercadoLibreCategoryAttributesContract,
  MercadoLibreCategoryContract,
} from "@eauto/domain";

const scope = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  categoryId: "MLC1234",
});
const now = new Date("2026-07-28T16:00:00.000Z");

class MemoryTaxonomyStore implements MercadoLibreTaxonomySnapshotStore {
  category: MercadoLibreCategoryContract | null = null;
  attributes: MercadoLibreCategoryAttributesContract | null = null;
  savedCategories = 0;
  savedAttributes = 0;

  getCategory(input: MercadoLibreTaxonomyScope): Promise<MercadoLibreCategoryContract | null> {
    expect(input).toEqual(scope);
    return Promise.resolve(this.category);
  }

  getCategoryAttributes(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryAttributesContract | null> {
    expect(input).toEqual(scope);
    return Promise.resolve(this.attributes);
  }

  saveCategory(
    input: MercadoLibreTaxonomyScope & Readonly<{ snapshot: MercadoLibreCategoryContract }>,
  ): Promise<void> {
    expect(input.organizationId).toBe(scope.organizationId);
    expect(input.accountId).toBe(scope.accountId);
    expect(input.categoryId).toBe(scope.categoryId);
    this.category = input.snapshot;
    this.savedCategories += 1;
    return Promise.resolve();
  }

  saveCategoryAttributes(
    input: MercadoLibreTaxonomyScope &
      Readonly<{ snapshot: MercadoLibreCategoryAttributesContract }>,
  ): Promise<void> {
    expect(input.organizationId).toBe(scope.organizationId);
    expect(input.accountId).toBe(scope.accountId);
    expect(input.categoryId).toBe(scope.categoryId);
    this.attributes = input.snapshot;
    this.savedAttributes += 1;
    return Promise.resolve();
  }
}

function category(
  observedAt: string,
  sourceHash = "a".repeat(64),
  categoryId = scope.categoryId,
): MercadoLibreCategoryContract {
  return Object.freeze({
    id: categoryId,
    siteId: "MLC",
    name: "Esquiladoras",
    pathFromRoot: Object.freeze([
      Object.freeze({ id: "MLC1000", name: "Agro" }),
      Object.freeze({ id: categoryId, name: "Esquiladoras" }),
    ]),
    childrenCategoryIds: Object.freeze([]),
    listingAllowed: true,
    status: "enabled",
    evidence: Object.freeze({ observedAt, sourceHash }),
  });
}

function attributes(
  observedAt: string,
  sourceHash = "b".repeat(64),
): MercadoLibreCategoryAttributesContract {
  return Object.freeze({
    categoryId: scope.categoryId,
    attributes: Object.freeze([
      Object.freeze({
        id: "ITEM_CONDITION",
        name: "Condición",
        valueType: "list",
        required: true,
        fixed: false,
        allowedValues: Object.freeze([Object.freeze({ id: "2230284", name: "Nuevo" })]),
      }),
    ]),
    evidence: Object.freeze({ observedAt, sourceHash }),
  });
}

function makeSource() {
  const getCategory = vi.fn<ForReadingMercadoLibreTaxonomy["getCategory"]>();
  const getCategoryAttributes = vi.fn<ForReadingMercadoLibreTaxonomy["getCategoryAttributes"]>();
  getCategory.mockResolvedValue(null);
  getCategoryAttributes.mockResolvedValue(null);
  return {
    reader: Object.freeze({ getCategory, getCategoryAttributes }),
    getCategory,
    getCategoryAttributes,
  };
}

describe("FreshMercadoLibreTaxonomyReader", () => {
  it("returns fresh category evidence without calling the official source", async () => {
    const store = new MemoryTaxonomyStore();
    store.category = category("2026-07-28T15:30:00.000Z");
    const source = makeSource();
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    await expect(reader.getCategory(scope)).resolves.toBe(store.category);
    expect(source.getCategory).not.toHaveBeenCalled();
    expect(store.savedCategories).toBe(0);
  });

  it("shares one refresh for concurrent stale category reads", async () => {
    const store = new MemoryTaxonomyStore();
    store.category = category("2026-07-28T14:00:00.000Z", "1".repeat(64));
    const current = category("2026-07-28T16:00:00.000Z", "2".repeat(64));
    const source = makeSource();
    source.getCategory.mockImplementation(async () => {
      await Promise.resolve();
      return current;
    });
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    const results = await Promise.all([reader.getCategory(scope), reader.getCategory(scope)]);

    expect(results).toEqual([current, current]);
    expect(source.getCategory).toHaveBeenCalledTimes(1);
    expect(store.savedCategories).toBe(1);
    expect(store.category).toBe(current);
  });

  it("refreshes future-dated evidence instead of treating it as fresh", async () => {
    const store = new MemoryTaxonomyStore();
    store.category = category("2026-07-28T16:00:00.001Z", "3".repeat(64));
    const current = category("2026-07-28T16:00:00.000Z", "4".repeat(64));
    const source = makeSource();
    source.getCategory.mockResolvedValue(current);
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    await expect(reader.getCategory(scope)).resolves.toBe(current);
    expect(source.getCategory).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of returning stale evidence after a refresh failure", async () => {
    const store = new MemoryTaxonomyStore();
    const stale = category("2026-07-28T14:00:00.000Z", "5".repeat(64));
    store.category = stale;
    const source = makeSource();
    source.getCategory.mockRejectedValue(new Error("official taxonomy unavailable"));
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    await expect(reader.getCategory(scope)).rejects.toThrow(/official taxonomy unavailable/);
    expect(store.category).toBe(stale);
    expect(store.savedCategories).toBe(0);
  });

  it("rejects a refreshed category bound to another category", async () => {
    const store = new MemoryTaxonomyStore();
    const source = makeSource();
    source.getCategory.mockResolvedValue(
      category("2026-07-28T16:00:00.000Z", "6".repeat(64), "MLC9999"),
    );
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    await expect(reader.getCategory(scope)).rejects.toThrow(/outside the requested scope/);
    expect(store.savedCategories).toBe(0);
  });

  it("refreshes and persists stale category attributes independently", async () => {
    const store = new MemoryTaxonomyStore();
    store.attributes = attributes("2026-07-28T14:00:00.000Z", "7".repeat(64));
    const current = attributes("2026-07-28T16:00:00.000Z", "8".repeat(64));
    const source = makeSource();
    source.getCategoryAttributes.mockResolvedValue(current);
    const reader = new FreshMercadoLibreTaxonomyReader(store, source.reader, 3_600_000, () => now);

    await expect(reader.getCategoryAttributes(scope)).resolves.toBe(current);
    expect(source.getCategoryAttributes).toHaveBeenCalledTimes(1);
    expect(store.savedAttributes).toBe(1);
  });
});

describe("evidenceIsFresh", () => {
  it("accepts the exact maximum-age boundary and rejects invalid evidence", () => {
    expect(
      evidenceIsFresh(
        { observedAt: "2026-07-28T15:00:00.000Z", sourceHash: "9".repeat(64) },
        now,
        3_600_000,
      ),
    ).toBe(true);
    expect(
      evidenceIsFresh({ observedAt: "invalid", sourceHash: "9".repeat(64) }, now, 3_600_000),
    ).toBe(false);
  });
});

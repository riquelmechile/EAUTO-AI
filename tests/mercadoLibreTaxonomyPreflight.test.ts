import { describe, expect, it } from "vitest";
import {
  evaluateMercadoLibreTaxonomyPreflight,
  type MercadoLibreCategoryAttributesContract,
  type MercadoLibreCategoryContract,
  type MercadoLibreTaxonomyPolicy,
} from "@eauto/domain";

const observedAt = "2026-07-28T15:00:00.000Z";
const evaluatedAt = "2026-07-28T15:10:00.000Z";
const policy: MercadoLibreTaxonomyPolicy = Object.freeze({
  siteId: "MLC",
  maximumEvidenceAgeMs: 3_600_000,
  policyVersion: "meli-taxonomy-v1",
});
const category: MercadoLibreCategoryContract = Object.freeze({
  id: "MLC1234",
  siteId: "MLC",
  name: "Esquiladoras",
  pathFromRoot: Object.freeze([
    Object.freeze({ id: "MLC1000", name: "Agro" }),
    Object.freeze({ id: "MLC1234", name: "Esquiladoras" }),
  ]),
  childrenCategoryIds: Object.freeze([]),
  listingAllowed: true,
  status: "enabled",
  evidence: Object.freeze({ observedAt, sourceHash: "a".repeat(64) }),
});
const attributes: MercadoLibreCategoryAttributesContract = Object.freeze({
  categoryId: category.id,
  attributes: Object.freeze([
    Object.freeze({
      id: "BRAND",
      name: "Marca",
      valueType: "string",
      required: true,
      fixed: false,
      allowedValues: Object.freeze([]),
    }),
    Object.freeze({
      id: "ITEM_CONDITION",
      name: "Condición",
      valueType: "list",
      required: true,
      fixed: false,
      allowedValues: Object.freeze([
        Object.freeze({ id: "2230284", name: "Nuevo" }),
        Object.freeze({ id: "2230581", name: "Usado" }),
      ]),
    }),
  ]),
  evidence: Object.freeze({ observedAt, sourceHash: "b".repeat(64) }),
});

function evaluate(
  overrides: Partial<Parameters<typeof evaluateMercadoLibreTaxonomyPreflight>[0]> = {},
) {
  return evaluateMercadoLibreTaxonomyPreflight({
    category,
    attributes,
    submittedAttributes: [
      { id: "BRAND", valueId: null, valueName: "Genérica" },
      { id: "ITEM_CONDITION", valueId: "2230284", valueName: "Nuevo" },
    ],
    policy,
    evaluatedAt,
    ...overrides,
  });
}

describe("MercadoLibre taxonomy preflight", () => {
  it("returns ready for a current listable leaf with required attributes", () => {
    expect(evaluate()).toMatchObject({ status: "ready", reasons: [] });
  });

  it("blocks non-leaf and non-listable categories", () => {
    const result = evaluate({
      category: { ...category, childrenCategoryIds: ["MLC9999"], listingAllowed: false },
    });
    expect(result.status).toBe("blocked");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["category-not-leaf", "category-not-listable"]),
    );
  });

  it("blocks missing required and invalid list attributes", () => {
    const result = evaluate({
      submittedAttributes: [{ id: "ITEM_CONDITION", valueId: "invalid", valueName: "Roto" }],
    });
    expect(result.status).toBe("blocked");
    expect(result.missingRequiredAttributeIds).toEqual(["BRAND"]);
    expect(result.invalidAttributeIds).toEqual(["ITEM_CONDITION"]);
  });

  it("blocks attributes unknown to the category contract", () => {
    const result = evaluate({
      submittedAttributes: [
        { id: "BRAND", valueId: null, valueName: "Genérica" },
        { id: "ITEM_CONDITION", valueId: "2230284", valueName: "Nuevo" },
        { id: "ATTACKER_ATTRIBUTE", valueId: null, valueName: "x" },
      ],
    });
    expect(result.reasons).toContain("unknown-attribute");
    expect(result.invalidAttributeIds).toContain("ATTACKER_ATTRIBUTE");
  });

  it("blocks evidence from another site", () => {
    expect(
      evaluate({ category: { ...category, siteId: "MLA", id: "MLA1234" } }).reasons,
    ).toContain("category-site-mismatch");
  });

  it("returns incomplete for stale evidence", () => {
    const result = evaluate({ evaluatedAt: "2026-07-28T17:00:00.000Z" });
    expect(result).toMatchObject({ status: "incomplete", reasons: ["evidence-stale"] });
  });
});

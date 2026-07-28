import { describe, expect, it } from "vitest";
import {
  buildMercadoLibreSubmittedAttributes,
  createMercadoLibreAttributeDraft,
  mercadoLibreTaxonomyReasonLabel,
  mergeMissingMercadoLibreAttributeDrafts,
  normalizeMercadoLibreCategoryId,
} from "../apps/mobile/src/features/mercadolibre/taxonomyPreflight.js";

describe("Android MercadoLibre taxonomy preflight helpers", () => {
  it("normalizes Chile category IDs and rejects foreign or malformed categories", () => {
    expect(normalizeMercadoLibreCategoryId("  mlc1234 ")).toBe("MLC1234");
    expect(() => normalizeMercadoLibreCategoryId("MLA1234")).toThrow(/categoría chilena válida/);
    expect(() => normalizeMercadoLibreCategoryId("MLC-1234")).toThrow(/categoría chilena válida/);
  });

  it("builds a strict payload while preserving blank required rows as null values", () => {
    const drafts = [
      Object.freeze({
        ...createMercadoLibreAttributeDraft("one", " ITEM_CONDITION "),
        valueId: " 2230284 ",
      }),
      Object.freeze({
        ...createMercadoLibreAttributeDraft("two", " BRAND "),
        valueName: "  Genérica ",
      }),
      createMercadoLibreAttributeDraft("three", "MODEL"),
      createMercadoLibreAttributeDraft("ignored"),
    ];

    expect(buildMercadoLibreSubmittedAttributes(drafts)).toEqual([
      { id: "ITEM_CONDITION", valueId: "2230284", valueName: null },
      { id: "BRAND", valueId: null, valueName: "Genérica" },
      { id: "MODEL", valueId: null, valueName: null },
    ]);
  });

  it("adds only missing attribute rows that are not already present", () => {
    let key = 0;
    const drafts = [createMercadoLibreAttributeDraft("existing", "ITEM_CONDITION")];

    const merged = mergeMissingMercadoLibreAttributeDrafts(
      drafts,
      ["ITEM_CONDITION", "BRAND", "MODEL"],
      () => `generated-${++key}`,
    );

    expect(merged.map((draft) => ({ key: draft.key, id: draft.id }))).toEqual([
      { key: "existing", id: "ITEM_CONDITION" },
      { key: "generated-1", id: "BRAND" },
      { key: "generated-2", id: "MODEL" },
    ]);
  });

  it("renders server reasons without changing their meaning", () => {
    expect(mercadoLibreTaxonomyReasonLabel("missing-required-attribute")).toMatch(
      /Faltan atributos obligatorios/,
    );
    expect(mercadoLibreTaxonomyReasonLabel("category-not-listable")).toMatch(/no permite publicar/);
    expect(mercadoLibreTaxonomyReasonLabel("evidence-stale")).toMatch(/evidencia oficial/);
  });
});

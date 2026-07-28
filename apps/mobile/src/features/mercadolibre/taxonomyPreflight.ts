import type {
  MercadoLibreSubmittedAttribute,
  MercadoLibreTaxonomyPreflightReason,
  MercadoLibreTaxonomyPreflightResult,
} from "../../lib/api";

export type MercadoLibreAttributeDraft = Readonly<{
  key: string;
  id: string;
  valueId: string;
  valueName: string;
}>;

export function createMercadoLibreAttributeDraft(key: string, id = ""): MercadoLibreAttributeDraft {
  return Object.freeze({ key, id, valueId: "", valueName: "" });
}

export function normalizeMercadoLibreCategoryId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^MLC\d+$/.test(normalized)) {
    throw new Error("Ingrese una categoría chilena válida, por ejemplo MLC1234.");
  }
  return normalized;
}

export function buildMercadoLibreSubmittedAttributes(
  drafts: readonly MercadoLibreAttributeDraft[],
): readonly MercadoLibreSubmittedAttribute[] {
  return Object.freeze(
    drafts
      .filter((draft) => draft.id.trim().length > 0)
      .map((draft) =>
        Object.freeze({
          id: draft.id.trim(),
          valueId: nullableTrimmed(draft.valueId),
          valueName: nullableTrimmed(draft.valueName),
        }),
      ),
  );
}

export function mergeMissingMercadoLibreAttributeDrafts(
  drafts: readonly MercadoLibreAttributeDraft[],
  missingAttributeIds: readonly string[],
  createKey: () => string,
): readonly MercadoLibreAttributeDraft[] {
  const existingIds = new Set(drafts.map((draft) => draft.id.trim()).filter(Boolean));
  const additions = missingAttributeIds
    .filter((attributeId) => !existingIds.has(attributeId))
    .map((attributeId) => createMercadoLibreAttributeDraft(createKey(), attributeId));
  return Object.freeze([...drafts, ...additions]);
}

export function mercadoLibreTaxonomyStatusMessage(
  result: MercadoLibreTaxonomyPreflightResult,
): string {
  switch (result.status) {
    case "ready":
      return "La taxonomía oficial está lista. No se creó ni publicó ningún producto.";
    case "blocked":
      return "La taxonomía oficial bloqueó el avance. Corrija los puntos indicados y vuelva a verificar.";
    case "incomplete":
      return "La evidencia oficial está incompleta o vencida. No se puede continuar todavía.";
  }
}

export function mercadoLibreTaxonomyReasonLabel(
  reason: MercadoLibreTaxonomyPreflightReason,
): string {
  switch (reason) {
    case "attribute-evidence-mismatch":
      return "Los atributos oficiales no corresponden a la categoría.";
    case "category-not-leaf":
      return "La categoría no es final; seleccione una categoría hoja.";
    case "category-not-listable":
      return "MercadoLibre no permite publicar en esta categoría.";
    case "category-site-mismatch":
      return "La categoría no pertenece a MercadoLibre Chile.";
    case "duplicate-submitted-attribute":
      return "Hay atributos enviados más de una vez.";
    case "evidence-stale":
      return "La evidencia oficial está vencida o fechada en el futuro.";
    case "invalid-attribute-value":
      return "Uno o más valores no están permitidos por MercadoLibre.";
    case "missing-required-attribute":
      return "Faltan atributos obligatorios.";
    case "unknown-attribute":
      return "Se enviaron atributos desconocidos para esta categoría.";
  }
}

function nullableTrimmed(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

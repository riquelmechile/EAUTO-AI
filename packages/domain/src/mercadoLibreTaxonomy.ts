export type MercadoLibreTaxonomyEvidence = Readonly<{
  observedAt: string;
  sourceHash: string;
}>;

export type MercadoLibreCategoryContract = Readonly<{
  id: string;
  siteId: string;
  name: string;
  pathFromRoot: readonly Readonly<{ id: string; name: string }>[];
  childrenCategoryIds: readonly string[];
  listingAllowed: boolean;
  status: string;
  evidence: MercadoLibreTaxonomyEvidence;
}>;

export type MercadoLibreCategoryAttributeContract = Readonly<{
  id: string;
  name: string;
  valueType: "string" | "number" | "list" | "boolean" | "number_unit";
  required: boolean;
  fixed: boolean;
  allowedValues: readonly Readonly<{ id: string; name: string }>[];
}>;

export type MercadoLibreCategoryAttributesContract = Readonly<{
  categoryId: string;
  attributes: readonly MercadoLibreCategoryAttributeContract[];
  evidence: MercadoLibreTaxonomyEvidence;
}>;

export type MercadoLibreSubmittedAttribute = Readonly<{
  id: string;
  valueId: string | null;
  valueName: string | null;
}>;

export type MercadoLibreTaxonomyPolicy = Readonly<{
  siteId: "MLC";
  maximumEvidenceAgeMs: number;
  policyVersion: string;
}>;

export type MercadoLibreTaxonomyPreflightReason =
  | "attribute-evidence-mismatch"
  | "category-not-leaf"
  | "category-not-listable"
  | "category-site-mismatch"
  | "duplicate-submitted-attribute"
  | "evidence-stale"
  | "invalid-attribute-value"
  | "missing-required-attribute"
  | "unknown-attribute";

export type MercadoLibreTaxonomyPreflightResult = Readonly<{
  status: "ready" | "blocked" | "incomplete";
  categoryId: string;
  reasons: readonly MercadoLibreTaxonomyPreflightReason[];
  missingRequiredAttributeIds: readonly string[];
  invalidAttributeIds: readonly string[];
  evidenceRefs: readonly string[];
  policyVersion: string;
  evaluatedAt: string;
}>;

export function evaluateMercadoLibreTaxonomyPreflight(input: {
  category: MercadoLibreCategoryContract;
  attributes: MercadoLibreCategoryAttributesContract;
  submittedAttributes: readonly MercadoLibreSubmittedAttribute[];
  policy: MercadoLibreTaxonomyPolicy;
  evaluatedAt: string;
}): MercadoLibreTaxonomyPreflightResult {
  validatePolicy(input.policy);
  const evaluatedAt = parseDate(input.evaluatedAt, "evaluatedAt");
  const categoryObservedAt = parseDate(input.category.evidence.observedAt, "category.observedAt");
  const attributesObservedAt = parseDate(
    input.attributes.evidence.observedAt,
    "attributes.observedAt",
  );
  const evidenceRefs = Object.freeze([
    `mercadolibre-category:${input.category.id}:${input.category.evidence.sourceHash}`,
    `mercadolibre-category-attributes:${input.attributes.categoryId}:${input.attributes.evidence.sourceHash}`,
  ]);

  const stale = [categoryObservedAt, attributesObservedAt].some(
    (date) =>
      evaluatedAt.getTime() < date.getTime() ||
      evaluatedAt.getTime() - date.getTime() > input.policy.maximumEvidenceAgeMs,
  );
  if (stale) {
    return result(input, "incomplete", ["evidence-stale"], [], [], evidenceRefs);
  }

  const reasons = new Set<MercadoLibreTaxonomyPreflightReason>();
  if (input.category.siteId !== input.policy.siteId || !input.category.id.startsWith("MLC")) {
    reasons.add("category-site-mismatch");
  }
  if (input.category.childrenCategoryIds.length > 0) reasons.add("category-not-leaf");
  if (!input.category.listingAllowed || input.category.status !== "enabled") {
    reasons.add("category-not-listable");
  }
  if (input.attributes.categoryId !== input.category.id) {
    reasons.add("attribute-evidence-mismatch");
  }

  const submitted = new Map<string, MercadoLibreSubmittedAttribute>();
  for (const attribute of input.submittedAttributes) {
    if (submitted.has(attribute.id)) reasons.add("duplicate-submitted-attribute");
    submitted.set(attribute.id, attribute);
  }

  const contracts = new Map(
    input.attributes.attributes.map((attribute) => [attribute.id, attribute]),
  );
  const missingRequired: string[] = [];
  const invalid: string[] = [];

  for (const contract of input.attributes.attributes) {
    const value = submitted.get(contract.id);
    if (contract.required && !hasValue(value)) {
      missingRequired.push(contract.id);
      reasons.add("missing-required-attribute");
      continue;
    }
    if (value && !isAllowed(contract, value)) {
      invalid.push(contract.id);
      reasons.add("invalid-attribute-value");
    }
  }
  for (const attribute of input.submittedAttributes) {
    if (!contracts.has(attribute.id)) {
      invalid.push(attribute.id);
      reasons.add("unknown-attribute");
    }
  }

  return result(
    input,
    reasons.size === 0 ? "ready" : "blocked",
    [...reasons].sort(),
    [...new Set(missingRequired)].sort(),
    [...new Set(invalid)].sort(),
    evidenceRefs,
  );
}

function isAllowed(
  contract: MercadoLibreCategoryAttributeContract,
  value: MercadoLibreSubmittedAttribute,
): boolean {
  if (!hasValue(value)) return !contract.required;
  if (contract.valueType !== "list" && !contract.fixed) return true;
  if (contract.allowedValues.length === 0) return false;
  return contract.allowedValues.some(
    (allowed) =>
      (value.valueId !== null && value.valueId === allowed.id) ||
      (value.valueName !== null &&
        value.valueName.trim().toLowerCase() === allowed.name.toLowerCase()),
  );
}

function hasValue(value: MercadoLibreSubmittedAttribute | undefined): boolean {
  return Boolean(value && (value.valueId?.trim() || value.valueName?.trim()));
}

function result(
  input: Parameters<typeof evaluateMercadoLibreTaxonomyPreflight>[0],
  status: MercadoLibreTaxonomyPreflightResult["status"],
  reasons: readonly MercadoLibreTaxonomyPreflightReason[],
  missingRequiredAttributeIds: readonly string[],
  invalidAttributeIds: readonly string[],
  evidenceRefs: readonly string[],
): MercadoLibreTaxonomyPreflightResult {
  return Object.freeze({
    status,
    categoryId: input.category.id,
    reasons: Object.freeze([...reasons]),
    missingRequiredAttributeIds: Object.freeze([...missingRequiredAttributeIds]),
    invalidAttributeIds: Object.freeze([...invalidAttributeIds]),
    evidenceRefs,
    policyVersion: input.policy.policyVersion,
    evaluatedAt: input.evaluatedAt,
  });
}

function validatePolicy(policy: MercadoLibreTaxonomyPolicy): void {
  if (policy.siteId !== "MLC") throw new Error("Only MercadoLibre Chile site MLC is supported.");
  if (!Number.isSafeInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be a non-negative safe integer.");
  }
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required.");
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date.`);
  return parsed;
}

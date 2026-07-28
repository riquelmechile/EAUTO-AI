import {
  evaluateMercadoLibreTaxonomyPreflight,
  type MercadoLibreCategoryAttributesContract,
  type MercadoLibreCategoryContract,
  type MercadoLibreSubmittedAttribute,
  type MercadoLibreTaxonomyPolicy,
  type MercadoLibreTaxonomyPreflightResult,
} from "@eauto/domain";

export type ForReadingMercadoLibreTaxonomy = {
  getCategory(input: {
    organizationId: string;
    accountId: string;
    categoryId: string;
  }): Promise<MercadoLibreCategoryContract | null>;
  getCategoryAttributes(input: {
    organizationId: string;
    accountId: string;
    categoryId: string;
  }): Promise<MercadoLibreCategoryAttributesContract | null>;
};

export class MercadoLibreTaxonomyPreflightService {
  constructor(
    private readonly taxonomy: ForReadingMercadoLibreTaxonomy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async preflight(input: {
    organizationId: string;
    accountId: string;
    categoryId: string;
    submittedAttributes: readonly MercadoLibreSubmittedAttribute[];
    policy: MercadoLibreTaxonomyPolicy;
  }): Promise<MercadoLibreTaxonomyPreflightResult> {
    assertRequired(input.organizationId, "organizationId");
    assertRequired(input.accountId, "accountId");
    assertRequired(input.categoryId, "categoryId");

    const [category, attributes] = await Promise.all([
      this.taxonomy.getCategory({
        organizationId: input.organizationId,
        accountId: input.accountId,
        categoryId: input.categoryId,
      }),
      this.taxonomy.getCategoryAttributes({
        organizationId: input.organizationId,
        accountId: input.accountId,
        categoryId: input.categoryId,
      }),
    ]);
    if (!category || !attributes) {
      throw new Error("Current MercadoLibre category and attribute evidence is required.");
    }
    if (category.id !== input.categoryId || attributes.categoryId !== input.categoryId) {
      throw new Error(
        "MercadoLibre taxonomy reader returned evidence outside the requested category.",
      );
    }

    return evaluateMercadoLibreTaxonomyPreflight({
      category,
      attributes,
      submittedAttributes: input.submittedAttributes,
      policy: input.policy,
      evaluatedAt: this.now().toISOString(),
    });
  }
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

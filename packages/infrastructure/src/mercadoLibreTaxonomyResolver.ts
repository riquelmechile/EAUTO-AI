import { createHash } from "node:crypto";
import type {
  ForResolvingMercadoLibreProductTaxonomy,
  MercadoLibreClientPort,
  MercadoLibreConnectionRepository,
  MercadoLibreSecurityPort,
} from "@eauto/application";
import type {
  MercadoLibreCategoryAttribute,
  MercadoLibrePredictedAttribute,
  ProductTaxonomyPrediction,
} from "@eauto/domain";

export type MercadoLibreTaxonomyResolverConfig = Readonly<{
  apiBaseUrl: string;
  expectedSellerIds: Readonly<Record<string, string>>;
  refreshWindowMs: number;
  refreshLeaseMs: number;
  timeoutMs: number;
  maximumResponseBytes: number;
}>;

export class MercadoLibreTaxonomyResolver implements ForResolvingMercadoLibreProductTaxonomy {
  constructor(
    private readonly connections: MercadoLibreConnectionRepository,
    private readonly security: MercadoLibreSecurityPort,
    private readonly tokenClient: Pick<MercadoLibreClientPort, "refreshAccessToken">,
    private readonly clock: { now(): Date },
    private readonly config: MercadoLibreTaxonomyResolverConfig,
  ) {}

  async resolveProductTaxonomy(input: {
    organizationId: string;
    accountId: string;
    query: string;
    predictionLimit: number;
    predictionTarget: "core";
  }): Promise<readonly ProductTaxonomyPrediction[]> {
    assertRequired(input.organizationId, "organizationId");
    assertRequired(input.accountId, "accountId");
    assertRequired(input.query, "query");
    if (!Number.isSafeInteger(input.predictionLimit) || input.predictionLimit < 1 || input.predictionLimit > 8) {
      throw new Error("MercadoLibre taxonomy predictionLimit must be between 1 and 8.");
    }
    if (input.predictionTarget !== "core") {
      throw new Error("MercadoLibre taxonomy prediction target must be core.");
    }
    const token = await this.ensureAccessToken(input.organizationId, input.accountId);
    const predictorUrl = new URL("/sites/MLC/domain_discovery/search", this.config.apiBaseUrl);
    predictorUrl.searchParams.set("limit", String(input.predictionLimit));
    predictorUrl.searchParams.set("q", input.query);
    predictorUrl.searchParams.set("target", input.predictionTarget);
    const predictorPayload = await this.getJson(predictorUrl, token);
    if (!Array.isArray(predictorPayload)) {
      throw new Error("MercadoLibre category predictor response must be an array.");
    }

    const predictions: ProductTaxonomyPrediction[] = [];
    for (const raw of predictorPayload.slice(0, input.predictionLimit)) {
      const normalized = normalizePrediction(raw);
      const attributesUrl = new URL(
        `/categories/${encodeURIComponent(normalized.categoryId)}/attributes`,
        this.config.apiBaseUrl,
      );
      const attributesPayload = await this.getJson(attributesUrl, token);
      if (!Array.isArray(attributesPayload)) {
        throw new Error(`MercadoLibre attributes for ${normalized.categoryId} must be an array.`);
      }
      const categoryAttributes = Object.freeze(attributesPayload.map(normalizeCategoryAttribute));
      const predictorHash = hashCanonical(raw);
      const attributesHash = hashCanonical(attributesPayload);
      predictions.push(
        Object.freeze({
          ...normalized,
          categoryAttributes,
          requiredAttributeIds: Object.freeze(
            categoryAttributes
              .filter((attribute) => attribute.required)
              .map((attribute) => attribute.id)
              .sort(),
          ),
          catalogRequiredAttributeIds: Object.freeze(
            categoryAttributes
              .filter((attribute) => attribute.catalogRequired)
              .map((attribute) => attribute.id)
              .sort(),
          ),
          evidenceRefs: Object.freeze([
            `mercadolibre:MLC:domain-discovery:${predictorHash}`,
            `mercadolibre:MLC:category-attributes:${normalized.categoryId}:${attributesHash}`,
          ]),
          sourceHash: hashCanonical({ predictor: raw, attributes: attributesPayload }),
        }),
      );
    }
    return Object.freeze(predictions);
  }

  private async ensureAccessToken(organizationId: string, accountId: string): Promise<string> {
    const connection = await this.connections.get({ organizationId, accountId });
    if (!connection) throw new Error(`MercadoLibre account ${accountId} is not connected.`);
    const expectedSellerId = this.config.expectedSellerIds[accountId];
    if (!expectedSellerId || connection.sellerId !== expectedSellerId || connection.siteId !== "MLC") {
      throw new Error(`MercadoLibre account ${accountId} has an unexpected Chile seller identity.`);
    }
    const now = this.clock.now();
    if (
      connection.status === "active" &&
      new Date(connection.expiresAt).getTime() - now.getTime() > this.config.refreshWindowMs
    ) {
      return this.security.decrypt(connection.encryptedAccessToken);
    }
    if (connection.status === "reauthorization-required" || connection.status === "revoked") {
      throw new Error(`MercadoLibre account ${accountId} requires reauthorization.`);
    }
    const leaseOwner = `taxonomy-${accountId}-${now.getTime()}`;
    const acquired = await this.connections.acquireRefreshLease({
      organizationId,
      accountId,
      leaseOwner,
      leaseUntil: new Date(now.getTime() + this.config.refreshLeaseMs).toISOString(),
      now: now.toISOString(),
    });
    if (!acquired) {
      throw new Error(`MercadoLibre account ${accountId} token refresh is already in progress.`);
    }
    try {
      const refreshed = await this.tokenClient.refreshAccessToken(
        this.security.decrypt(connection.encryptedRefreshToken),
      );
      const refreshedAt = this.clock.now();
      await this.connections.saveConnection({
        ...connection,
        encryptedAccessToken: this.security.encrypt(refreshed.accessToken),
        encryptedRefreshToken: this.security.encrypt(refreshed.refreshToken),
        expiresAt: new Date(refreshedAt.getTime() + refreshed.expiresInSeconds * 1_000).toISOString(),
        status: "active",
        refreshLeaseOwner: null,
        refreshLeaseUntil: null,
        updatedAt: refreshedAt.toISOString(),
      });
      return refreshed.accessToken;
    } catch (error) {
      const refreshedAt = this.clock.now();
      await this.connections.saveConnection({
        ...connection,
        status: "reauthorization-required",
        refreshLeaseOwner: null,
        refreshLeaseUntil: null,
        updatedAt: refreshedAt.toISOString(),
      });
      throw error;
    }
  }

  private async getJson(url: URL, accessToken: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": "eauto-ai/mercadolibre-taxonomy",
        },
        redirect: "error",
        signal: controller.signal,
      });
      const text = await readLimitedResponse(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(`MercadoLibre taxonomy HTTP ${response.status}: ${sanitize(text)}`);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("MercadoLibre taxonomy returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MercadoLibre taxonomy request timed out after ${this.config.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizePrediction(value: unknown): Omit<
  ProductTaxonomyPrediction,
  | "categoryAttributes"
  | "requiredAttributeIds"
  | "catalogRequiredAttributeIds"
  | "evidenceRefs"
  | "sourceHash"
> {
  if (!isRecord(value)) throw new Error("MercadoLibre taxonomy prediction must be an object.");
  const domainId = requiredString(value.domain_id, "prediction.domain_id");
  const domainName = requiredString(value.domain_name, "prediction.domain_name");
  const categoryId = requiredString(value.category_id, "prediction.category_id");
  const categoryName = requiredString(value.category_name, "prediction.category_name");
  if (!domainId.startsWith("MLC-")) {
    throw new Error(`MercadoLibre predictor returned domain outside MLC: ${domainId}.`);
  }
  if (!categoryId.startsWith("MLC")) {
    throw new Error(`MercadoLibre predictor returned category outside MLC: ${categoryId}.`);
  }
  const rawAttributes = value.attributes ?? [];
  if (!Array.isArray(rawAttributes)) {
    throw new Error("MercadoLibre predicted attributes must be an array.");
  }
  return Object.freeze({
    domainId,
    domainName,
    categoryId,
    categoryName,
    suggestedAttributes: Object.freeze(rawAttributes.map(normalizePredictedAttribute)),
  });
}

function normalizePredictedAttribute(value: unknown): MercadoLibrePredictedAttribute {
  if (!isRecord(value)) throw new Error("MercadoLibre predicted attribute must be an object.");
  return Object.freeze({
    id: requiredString(value.id, "predictedAttribute.id"),
    valueId: optionalString(value.value_id),
    valueName: optionalString(value.value_name),
  });
}

function normalizeCategoryAttribute(value: unknown): MercadoLibreCategoryAttribute {
  if (!isRecord(value)) throw new Error("MercadoLibre category attribute must be an object.");
  const tags = isRecord(value.tags) ? value.tags : {};
  const rawValues = value.values ?? [];
  if (!Array.isArray(rawValues)) throw new Error("MercadoLibre category attribute values must be an array.");
  const values = rawValues
    .filter(isRecord)
    .map((entry) => {
      const id = optionalString(entry.id);
      const name = optionalString(entry.name);
      return id && name ? Object.freeze({ id, name }) : null;
    })
    .filter((entry): entry is Readonly<{ id: string; name: string }> => entry !== null);
  return Object.freeze({
    id: requiredString(value.id, "categoryAttribute.id"),
    name: requiredString(value.name, "categoryAttribute.name"),
    valueType: requiredString(value.value_type, "categoryAttribute.value_type"),
    required: tags.required === true,
    catalogRequired: tags.catalog_required === true,
    fixed: tags.fixed === true,
    values: Object.freeze(values),
  });
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`MercadoLibre taxonomy response exceeds ${maximumBytes} bytes.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximumBytes) {
    throw new Error(`MercadoLibre taxonomy response exceeds ${maximumBytes} bytes.`);
  }
  return new TextDecoder().decode(body);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

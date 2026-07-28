import { createHash } from "node:crypto";
import {
  CatalogAcquisitionUnavailableError,
  CatalogAcquisitionValidationError,
  type PhotoSimilarityMatch,
  type SupplierCatalogOffer,
} from "@eauto/domain";
import type { PhotoSimilarityPort, SupplierCatalogSearchPort } from "@eauto/application";

export class DisabledPhotoSimilarityProvider implements PhotoSimilarityPort {
  findSimilar(): Promise<readonly PhotoSimilarityMatch[]> {
    return Promise.reject(new CatalogAcquisitionUnavailableError());
  }
}

export class DisabledSupplierCatalogProvider implements SupplierCatalogSearchPort {
  search(): Promise<readonly SupplierCatalogOffer[]> {
    return Promise.reject(new CatalogAcquisitionUnavailableError());
  }
}

export class HttpPhotoSimilarityProvider implements PhotoSimilarityPort {
  constructor(
    private readonly config: Readonly<{
      endpoint: string;
      apiKey: string;
      providerName: string;
      timeoutMs: number;
      maximumResponseBytes: number;
    }>,
  ) {
    assertGatewayUrl(config.endpoint, "Visual similarity endpoint");
  }

  async findSimilar(
    input: Parameters<PhotoSimilarityPort["findSimilar"]>[0],
  ): Promise<readonly PhotoSimilarityMatch[]> {
    const response = await postJson(
      this.config.endpoint,
      this.config.apiKey,
      {
        schemaVersion: "eauto-photo-similarity-request-v1",
        organizationId: input.organizationId,
        accountId: input.accountId,
        sourceImageUploadId: input.sourceImageUploadId,
        objectUri: input.objectUri,
        checksumSha256Base64: input.checksumSha256Base64,
      },
      `photo:${input.accountId}:${input.sourceImageUploadId}:${input.checksumSha256Base64}`,
      this.config,
    );
    if (!isRecord(response) || !Array.isArray(response.matches)) {
      throw new CatalogAcquisitionValidationError(
        "Visual similarity provider response must contain a matches array.",
      );
    }
    if (response.matches.length > 20) {
      throw new CatalogAcquisitionValidationError(
        "Visual similarity provider returned more than 20 matches.",
      );
    }
    return Object.freeze(
      response.matches.map((entry, index) => parsePhotoMatch(entry, index, input, this.config)),
    );
  }
}

export class HttpSupplierCatalogProvider implements SupplierCatalogSearchPort {
  constructor(
    private readonly routes: Readonly<Record<string, string>>,
    private readonly config: Readonly<{
      apiKey: string;
      providerName: string;
      timeoutMs: number;
      maximumResponseBytes: number;
    }>,
  ) {
    for (const [sourceId, endpoint] of Object.entries(routes)) {
      if (!sourceId.trim()) {
        throw new CatalogAcquisitionValidationError("Supplier route IDs cannot be empty.");
      }
      assertGatewayUrl(endpoint, `Supplier route ${sourceId}`);
    }
  }

  async search(
    input: Parameters<SupplierCatalogSearchPort["search"]>[0],
  ): Promise<readonly SupplierCatalogOffer[]> {
    const endpoint = this.routes[input.supplierSourceId];
    if (!endpoint) {
      throw new CatalogAcquisitionUnavailableError(
        `Supplier source ${input.supplierSourceId} has no configured catalog route.`,
      );
    }
    const response = await postJson(
      endpoint,
      this.config.apiKey,
      {
        schemaVersion: "eauto-supplier-catalog-request-v1",
        organizationId: input.organizationId,
        accountId: input.accountId,
        supplierSourceId: input.supplierSourceId,
        query: input.query,
        candidateUrl: input.candidateUrl,
      },
      `catalog:${input.accountId}:${input.supplierSourceId}:${hashText(input.query)}`,
      this.config,
    );
    if (!isRecord(response) || !Array.isArray(response.offers)) {
      throw new CatalogAcquisitionValidationError(
        "Supplier catalog provider response must contain an offers array.",
      );
    }
    if (response.offers.length > 50) {
      throw new CatalogAcquisitionValidationError(
        "Supplier catalog provider returned more than 50 offers.",
      );
    }
    return Object.freeze(
      response.offers.map((entry, index) =>
        parseSupplierOffer(entry, index, input, this.config.providerName),
      ),
    );
  }
}

function parsePhotoMatch(
  value: unknown,
  index: number,
  input: Parameters<PhotoSimilarityPort["findSimilar"]>[0],
  config: Readonly<{ providerName: string }>,
): PhotoSimilarityMatch {
  if (!isRecord(value)) {
    throw new CatalogAcquisitionValidationError(`Visual match ${index} must be an object.`);
  }
  const observedAt = requireIsoDate(value.observedAt, `visual match ${index} observedAt`);
  const evidence = parseEvidence(value.evidence, `visual match ${index}`, observedAt);
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    sourceImageUploadId: input.sourceImageUploadId,
    provider: config.providerName,
    externalMatchId: requireString(value.externalMatchId, `visual match ${index} externalMatchId`),
    title: requireString(value.title, `visual match ${index} title`),
    candidateUrl: requireHttpsUrl(value.candidateUrl, `visual match ${index} candidateUrl`),
    similarityBps: requireBasisPoints(value.similarityBps, `visual match ${index} similarityBps`),
    observedAt,
    evidence: Object.freeze({ ...evidence, source: config.providerName }),
  });
}

function parseSupplierOffer(
  value: unknown,
  index: number,
  input: Parameters<SupplierCatalogSearchPort["search"]>[0],
  providerName: string,
): SupplierCatalogOffer {
  if (!isRecord(value)) {
    throw new CatalogAcquisitionValidationError(`Supplier offer ${index} must be an object.`);
  }
  const observedAt = requireIsoDate(value.observedAt, `supplier offer ${index} observedAt`);
  const evidence = parseEvidence(value.evidence, `supplier offer ${index}`, observedAt);
  const currencyId = requireString(
    value.currencyId,
    `supplier offer ${index} currencyId`,
  ).toUpperCase();
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    supplierSourceId: input.supplierSourceId,
    sku: requireString(value.sku, `supplier offer ${index} sku`),
    name: requireString(value.name, `supplier offer ${index} name`),
    productUrl: requireHttpsUrl(value.productUrl, `supplier offer ${index} productUrl`),
    unitCostMinor: requirePositiveInteger(
      value.unitCostMinor,
      `supplier offer ${index} unitCostMinor`,
    ),
    stockQuantity: requireNonNegativeInteger(
      value.stockQuantity,
      `supplier offer ${index} stockQuantity`,
    ),
    currencyId,
    observedAt,
    evidence: Object.freeze({
      ...evidence,
      source: `${providerName}:${input.supplierSourceId}`,
    }),
  });
}

function parseEvidence(
  value: unknown,
  label: string,
  observedAt: string,
): Readonly<{ id: string; source: string; observedAt: string; contentHash: string }> {
  if (!isRecord(value)) {
    throw new CatalogAcquisitionValidationError(`${label} evidence must be an object.`);
  }
  const evidenceObservedAt = requireIsoDate(value.observedAt, `${label} evidence observedAt`);
  if (evidenceObservedAt !== observedAt) {
    throw new CatalogAcquisitionValidationError(
      `${label} evidence timestamp must match its observation.`,
    );
  }
  const contentHash = requireString(
    value.contentHash,
    `${label} evidence contentHash`,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new CatalogAcquisitionValidationError(
      `${label} evidence contentHash must be a SHA-256 hex digest.`,
    );
  }
  return Object.freeze({
    id: requireString(value.id, `${label} evidence id`),
    source: "provider-normalized",
    observedAt,
    contentHash,
  });
}

async function postJson(
  endpoint: string,
  apiKey: string,
  body: unknown,
  idempotencyKey: string,
  config: Readonly<{ timeoutMs: number; maximumResponseBytes: number; providerName: string }>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "user-agent": "eauto-ai/catalog-acquisition",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readLimitedResponse(response, config.maximumResponseBytes);
    if (!response.ok) {
      throw new Error(
        `${config.providerName} failed with HTTP ${response.status}: ${sanitize(text)}`,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CatalogAcquisitionValidationError(`${config.providerName} returned invalid JSON.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${config.providerName} timed out after ${config.timeoutMs} ms.`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Catalog provider response exceeds the ${maximumBytes} byte limit.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximumBytes) {
    throw new Error(`Catalog provider response exceeds the ${maximumBytes} byte limit.`);
  }
  return new TextDecoder().decode(body);
}

function assertGatewayUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new CatalogAcquisitionValidationError(
      `${label} must be an HTTPS URL without credentials or fragment.`,
    );
  }
}

function requireHttpsUrl(value: unknown, label: string): string {
  const rendered = requireString(value, label);
  assertGatewayUrl(rendered, label);
  return rendered;
}

function requireIsoDate(value: unknown, label: string): string {
  const rendered = requireString(value, label);
  if (!Number.isFinite(Date.parse(rendered))) {
    throw new CatalogAcquisitionValidationError(`${label} must be an ISO timestamp.`);
  }
  return rendered;
}

function requireBasisPoints(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw new CatalogAcquisitionValidationError(`${label} must be between 0 and 10000.`);
  }
  return Number(value);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new CatalogAcquisitionValidationError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CatalogAcquisitionValidationError(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CatalogAcquisitionValidationError(`${label} is required.`);
  }
  return value.trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

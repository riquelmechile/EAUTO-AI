import { createHash } from "node:crypto";
import type {
  ForComputingProductVisualFingerprints,
  ProductSourceImageRequest,
} from "@eauto/application";
import { validateProductVisualFingerprint, type ProductVisualFingerprint } from "@eauto/domain";

export class ProductFingerprintProviderValidationError extends Error {
  readonly code = "product-fingerprint-provider-invalid-response";

  constructor(message: string) {
    super(message);
    this.name = "ProductFingerprintProviderValidationError";
  }
}

export type HttpProductFingerprintProviderConfig = Readonly<{
  endpoint: string;
  apiKey: string;
  providerName: string;
  fingerprintVersion: string;
  timeoutMs: number;
  maximumResponseBytes: number;
}>;

export class HttpProductFingerprintProvider implements ForComputingProductVisualFingerprints {
  constructor(private readonly config: HttpProductFingerprintProviderConfig) {
    assertGatewayUrl(config.endpoint);
    assertRequired(config.apiKey, "Product fingerprint API key");
    assertRequired(config.providerName, "Product fingerprint provider name");
    assertRequired(config.fingerprintVersion, "Product fingerprint version");
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1_000) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint timeout must be a safe integer of at least 1000 ms.",
      );
    }
    if (!Number.isSafeInteger(config.maximumResponseBytes) || config.maximumResponseBytes < 1_024) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint response limit must be a safe integer of at least 1024 bytes.",
      );
    }
  }

  async compute(input: ProductSourceImageRequest): Promise<ProductVisualFingerprint> {
    validateInput(input);
    const response = await this.post({
      schemaVersion: "eauto-product-fingerprint-request-v1",
      organizationId: input.organizationId,
      accountId: input.accountId,
      sourceImageUploadId: input.sourceImageUploadId,
      objectUri: input.objectUri,
      checksumSha256Base64: input.contentHash,
    });
    if (!isRecord(response)) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider response must be an object.",
      );
    }
    if (response.schemaVersion !== "eauto-product-fingerprint-response-v1") {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider returned an unsupported schema version.",
      );
    }
    if (response.sourceImageUploadId !== input.sourceImageUploadId) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider response is bound to another source image upload.",
      );
    }
    if (response.checksumSha256Base64 !== input.contentHash) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider response is bound to another image checksum.",
      );
    }
    if (response.algorithm !== "phash-64") {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider must return algorithm phash-64.",
      );
    }
    if (response.version !== this.config.fingerprintVersion) {
      throw new ProductFingerprintProviderValidationError(
        `Product fingerprint provider must return allowlisted version ${this.config.fingerprintVersion}.`,
      );
    }
    if (typeof response.value !== "string" || !/^[01]{64}$/.test(response.value)) {
      throw new ProductFingerprintProviderValidationError(
        "Product fingerprint provider value must contain exactly 64 binary digits.",
      );
    }
    return validateProductVisualFingerprint(
      Object.freeze({
        algorithm: "phash-64",
        version: this.config.fingerprintVersion,
        value: response.value,
        evidenceRef: input.evidenceId,
      }),
    );
  }

  private async post(body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `fingerprint:${hashCanonical(body)}`,
          "user-agent": "eauto-ai/product-fingerprint",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await readLimitedResponse(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(
          `${this.config.providerName} failed with HTTP ${response.status}: ${sanitize(text)}`,
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProductFingerprintProviderValidationError(
          `${this.config.providerName} returned invalid JSON.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `${this.config.providerName} timed out after ${this.config.timeoutMs} ms.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateInput(input: ProductSourceImageRequest): void {
  for (const [label, value] of [
    ["organizationId", input.organizationId],
    ["accountId", input.accountId],
    ["sourceImageUploadId", input.sourceImageUploadId],
    ["objectUri", input.objectUri],
    ["contentHash", input.contentHash],
    ["evidenceId", input.evidenceId],
  ] as const) {
    assertRequired(value, label);
  }
  if (!input.objectUri.startsWith("s3://")) {
    throw new ProductFingerprintProviderValidationError(
      "Product fingerprint input objectUri must be a private S3 URI.",
    );
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input.contentHash)) {
    throw new ProductFingerprintProviderValidationError(
      "Product fingerprint input checksum must be a base64-encoded SHA-256 digest.",
    );
  }
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Product fingerprint response exceeds the ${maximumBytes} byte limit.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximumBytes) {
    throw new Error(`Product fingerprint response exceeds the ${maximumBytes} byte limit.`);
  }
  return new TextDecoder().decode(body);
}

function assertGatewayUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new ProductFingerprintProviderValidationError(
      "Product fingerprint endpoint must be an HTTPS URL without credentials or fragment.",
    );
  }
}

function assertRequired(value: string, label: string): void {
  if (!value.trim()) throw new ProductFingerprintProviderValidationError(`${label} is required.`);
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

import { createHash, randomUUID } from "node:crypto";
import type { ContentGenerationPort } from "@eauto/application";
import type { AssetKind, ContentAsset, ProductLaunchBrief } from "@eauto/domain";

export type GeneratedAssetStorage = Readonly<{
  putGeneratedObject(input: {
    objectKey: string;
    contentType: string;
    body: Uint8Array;
    checksumSha256Base64: string;
    metadata: Readonly<Record<string, string>>;
  }): Promise<Readonly<{ objectUri: string }>>;
}>;

export class DisabledContentProvider implements ContentGenerationPort {
  generateLaunchAssets(): Promise<readonly ContentAsset[]> {
    return Promise.reject(
      new Error(
        "External content generation is disabled. Configure CONTENT_GENERATION_ENABLED and provider credentials.",
      ),
    );
  }
}

export class HttpContentProvider implements ContentGenerationPort {
  constructor(
    private readonly storage: GeneratedAssetStorage,
    private readonly config: Readonly<{
      endpoint: string;
      apiKey: string;
      providerName: string;
      timeoutMs: number;
      maximumResponseBytes: number;
      maximumAssetBytes: number;
    }>,
  ) {}

  async generateLaunchAssets(brief: ProductLaunchBrief): Promise<readonly ContentAsset[]> {
    const response = await this.requestGeneration(brief);
    const providerAssets = parseProviderAssets(response);
    const generated: ContentAsset[] = [];
    for (const providerAsset of providerAssets) {
      generated.push(await this.persistAsset(brief, providerAsset));
    }
    return Object.freeze(generated);
  }

  private async requestGeneration(brief: ProductLaunchBrief): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `content:${brief.accountId}:${brief.id}`,
          "user-agent": "eauto-ai/production-content-provider",
        },
        body: JSON.stringify({
          schemaVersion: "eauto-content-request-v1",
          brief,
          requirements: {
            requiredKinds: ["image", "copy"],
            optionalKinds: ["video"],
            privateStorageRequired: true,
          },
        }),
        signal: controller.signal,
      });
      const text = await readLimitedResponse(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(`Content provider failed with HTTP ${response.status}: ${sanitize(text)}`);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("Content provider returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Content provider timed out after ${this.config.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistAsset(
    brief: ProductLaunchBrief,
    providerAsset: ProviderAsset,
  ): Promise<ContentAsset> {
    const loaded = await this.loadAsset(providerAsset);
    const hash = createHash("sha256").update(loaded.body).digest();
    const contentHash = hash.toString("hex");
    if (providerAsset.sha256Hex && providerAsset.sha256Hex.toLowerCase() !== contentHash) {
      throw new Error(`Content provider hash mismatch for ${providerAsset.kind}.`);
    }
    const assetId = `asset_${randomUUID()}`;
    const objectKey = [
      "accounts",
      encodeSegment(brief.accountId),
      "generated-content",
      encodeSegment(brief.id),
      `${encodeSegment(assetId)}.${extensionFor(loaded.contentType, providerAsset.kind)}`,
    ].join("/");
    const stored = await this.storage.putGeneratedObject({
      objectKey,
      contentType: loaded.contentType,
      body: loaded.body,
      checksumSha256Base64: hash.toString("base64"),
      metadata: Object.freeze({
        account: brief.accountId,
        product: brief.id,
        provider: this.config.providerName,
        model: providerAsset.model,
        prompt: providerAsset.promptVersion,
        kind: providerAsset.kind,
      }),
    });
    return Object.freeze({
      id: assetId,
      accountId: brief.accountId,
      productId: brief.id,
      kind: providerAsset.kind,
      uri: stored.objectUri,
      contentHash,
      provider: this.config.providerName,
      model: providerAsset.model,
      promptVersion: providerAsset.promptVersion,
      moderationStatus: providerAsset.moderationStatus,
      createdAt: new Date().toISOString(),
    });
  }

  private async loadAsset(
    asset: ProviderAsset,
  ): Promise<Readonly<{ body: Uint8Array; contentType: string }>> {
    if (asset.kind === "copy") {
      if (typeof asset.text !== "string" || asset.text.trim().length === 0) {
        throw new Error("Content provider copy asset requires non-empty text.");
      }
      const body = new TextEncoder().encode(asset.text);
      enforceMaximum(body.byteLength, this.config.maximumAssetBytes);
      return Object.freeze({ body, contentType: "text/plain; charset=utf-8" });
    }
    if (!asset.url) throw new Error(`Content provider ${asset.kind} asset requires a URL.`);
    const url = new URL(asset.url);
    if (url.protocol !== "https:") throw new Error("Generated asset URL must use HTTPS.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: asset.kind === "image" ? "image/*" : "video/*" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Generated asset download failed with HTTP ${response.status}.`);
      }
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength)) {
        enforceMaximum(declaredLength, this.config.maximumAssetBytes);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      enforceMaximum(body.byteLength, this.config.maximumAssetBytes);
      const contentType = normalizeContentType(response.headers.get("content-type"), asset.kind);
      return Object.freeze({ body, contentType });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Generated asset download timed out after ${this.config.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type ProviderAsset = Readonly<{
  kind: Extract<AssetKind, "image" | "video" | "copy">;
  url: string | null;
  text: string | null;
  model: string;
  promptVersion: string;
  moderationStatus: ContentAsset["moderationStatus"];
  sha256Hex: string | null;
}>;

function parseProviderAssets(value: unknown): readonly ProviderAsset[] {
  if (!isRecord(value) || !Array.isArray(value.assets)) {
    throw new Error("Content provider response must contain an assets array.");
  }
  if (value.assets.length === 0 || value.assets.length > 20) {
    throw new Error("Content provider must return between 1 and 20 assets.");
  }
  const assets = value.assets.map((entry, index) => parseProviderAsset(entry, index));
  const kinds = new Set(assets.map((asset) => asset.kind));
  for (const required of ["image", "copy"] as const) {
    if (!kinds.has(required))
      throw new Error(`Content provider omitted required ${required} asset.`);
  }
  return Object.freeze(assets);
}

function parseProviderAsset(value: unknown, index: number): ProviderAsset {
  if (!isRecord(value)) throw new Error(`Content provider asset ${index} must be an object.`);
  if (value.kind !== "image" && value.kind !== "video" && value.kind !== "copy") {
    throw new Error(`Content provider asset ${index} has an invalid kind.`);
  }
  const model = requireString(value.model, `asset ${index} model`);
  const promptVersion = requireString(value.promptVersion, `asset ${index} promptVersion`);
  const moderationStatus =
    value.moderationStatus === "approved" || value.moderationStatus === "rejected"
      ? value.moderationStatus
      : "pending";
  const sha256Hex =
    typeof value.sha256Hex === "string" && /^[a-f0-9]{64}$/i.test(value.sha256Hex)
      ? value.sha256Hex
      : null;
  return Object.freeze({
    kind: value.kind,
    url: typeof value.url === "string" ? value.url : null,
    text: typeof value.text === "string" ? value.text : null,
    model,
    promptVersion,
    moderationStatus,
    sha256Hex,
  });
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength)) enforceMaximum(declaredLength, maximumBytes);
  const body = new Uint8Array(await response.arrayBuffer());
  enforceMaximum(body.byteLength, maximumBytes);
  return new TextDecoder().decode(body);
}

function normalizeContentType(value: string | null, kind: "image" | "video"): string {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized.startsWith(`${kind}/`)) {
    throw new Error(`Generated ${kind} asset returned an invalid content type.`);
  }
  return normalized;
}

function extensionFor(contentType: string, kind: ProviderAsset["kind"]): string {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const extensions: Readonly<Record<string, string>> = Object.freeze({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "text/plain": "txt",
  });
  return (normalized && extensions[normalized]) || (kind === "copy" ? "txt" : "bin");
}

function enforceMaximum(value: number, maximum: number): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`Generated content exceeds the ${maximum} byte limit.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Content provider ${label} is required.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}

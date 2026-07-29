import { createHash, randomUUID } from "node:crypto";
import type { ContentGenerationPort } from "@eauto/application";
import type { ContentAsset, ProductLaunchBrief } from "@eauto/domain";
import type { GeneratedAssetStorage } from "./httpContentProvider.js";

const MINIMAX_API_ORIGIN = "https://api.minimax.io";

export class MiniMaxContentProvider implements ContentGenerationPort {
  constructor(
    private readonly storage: GeneratedAssetStorage,
    private readonly config: Readonly<{
      apiKey: string;
      imageModel: string;
      videoModel: string;
      promptVersion: string;
      generateVideo: boolean;
      timeoutMs: number;
      pollIntervalMs: number;
      maximumPolls: number;
      maximumResponseBytes: number;
      maximumAssetBytes: number;
    }>,
  ) {
    if (!config.apiKey.trim()) throw new Error("MiniMax API key is required.");
    if (config.timeoutMs < 1_000 || config.pollIntervalMs < 1_000 || config.maximumPolls < 1) {
      throw new Error("MiniMax timing configuration is invalid.");
    }
  }

  async generateLaunchAssets(brief: ProductLaunchBrief): Promise<readonly ContentAsset[]> {
    const prompt = buildPrompt(brief);
    const imageUrl = await this.generateImage(prompt);
    const assets: ContentAsset[] = [
      await this.persistRemoteAsset(brief, "image", imageUrl, this.config.imageModel),
      await this.persistCopy(brief, draftCopy(brief)),
    ];
    if (this.config.generateVideo) {
      const taskId = await this.startVideo(brief, prompt);
      const fileId = await this.waitForVideo(taskId);
      const videoUrl = await this.retrieveFileUrl(fileId);
      assets.push(await this.persistRemoteAsset(brief, "video", videoUrl, this.config.videoModel));
    }
    return Object.freeze(assets);
  }

  private async generateImage(prompt: string): Promise<string> {
    const payload = await this.requestJson("/v1/image_generation", {
      method: "POST",
      body: JSON.stringify({
        model: this.config.imageModel,
        prompt,
        aspect_ratio: "1:1",
        response_format: "url",
        n: 1,
        prompt_optimizer: true,
      }),
    });
    assertProviderSuccess(payload, "MiniMax image generation");
    const data = record(payload.data);
    const urls = Array.isArray(data?.image_urls) ? data.image_urls : [];
    const url = urls.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (url) return requireHttpsUrl(url, "MiniMax image");
    const images = Array.isArray(data?.images) ? data.images : [];
    for (const image of images) {
      const candidate = record(image)?.url;
      if (typeof candidate === "string" && candidate.length > 0) {
        return requireHttpsUrl(candidate, "MiniMax image");
      }
    }
    throw new Error("MiniMax image generation returned no image URL.");
  }

  private async startVideo(brief: ProductLaunchBrief, prompt: string): Promise<string> {
    const payload = await this.requestJson("/v1/video_generation", {
      method: "POST",
      body: JSON.stringify({
        model: this.config.videoModel,
        prompt,
        first_frame_image: requireHttpsUrl(brief.sourceImageUri, "source image"),
        prompt_optimizer: true,
      }),
    });
    assertProviderSuccess(payload, "MiniMax video generation");
    const taskId = payload.task_id;
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error("MiniMax video generation returned no task_id.");
    }
    return taskId;
  }

  private async waitForVideo(taskId: string): Promise<string> {
    for (let attempt = 1; attempt <= this.config.maximumPolls; attempt += 1) {
      if (attempt > 1) await delay(this.config.pollIntervalMs);
      const payload = await this.requestJson(
        `/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        { method: "GET" },
      );
      assertProviderSuccess(payload, "MiniMax video query");
      const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
      if (status === "success") {
        const fileId = payload.file_id;
        if (typeof fileId !== "string" || !fileId.trim()) {
          throw new Error("MiniMax completed video returned no file_id.");
        }
        return fileId;
      }
      if (status === "fail" || status === "failed") {
        throw new Error(`MiniMax video task ${taskId} failed.`);
      }
      if (!["queueing", "preparing", "processing", "running", ""].includes(status)) {
        throw new Error(`MiniMax video task returned unsupported status ${status}.`);
      }
    }
    throw new Error(`MiniMax video task exceeded ${this.config.maximumPolls} polling attempts.`);
  }

  private async retrieveFileUrl(fileId: string): Promise<string> {
    const payload = await this.requestJson(
      `/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      {
        method: "GET",
      },
    );
    assertProviderSuccess(payload, "MiniMax file retrieval");
    const file = record(payload.file);
    const url = file?.download_url;
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("MiniMax file retrieval returned no download_url.");
    }
    return requireHttpsUrl(url, "MiniMax video");
  }

  private async requestJson(
    path: string,
    init: Readonly<{ method: "GET" | "POST"; body?: string }>,
  ) {
    const url = new URL(path, MINIMAX_API_ORIGIN);
    if (url.origin !== MINIMAX_API_ORIGIN)
      throw new Error("MiniMax request escaped the official host.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: init.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          "user-agent": "eauto-ai/minimax-content-provider",
        },
        ...(init.body ? { body: init.body } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await readLimitedText(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(`MiniMax request failed with HTTP ${response.status}: ${sanitize(text)}`);
      }
      const parsed: unknown = JSON.parse(text);
      const value = record(parsed);
      if (!value) throw new Error("MiniMax returned a non-object JSON response.");
      return value;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MiniMax request timed out after ${this.config.timeoutMs} ms.`, {
          cause: error,
        });
      }
      if (error instanceof SyntaxError)
        throw new Error("MiniMax returned invalid JSON.", { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistRemoteAsset(
    brief: ProductLaunchBrief,
    kind: "image" | "video",
    remoteUrl: string,
    model: string,
  ): Promise<ContentAsset> {
    const loaded = await this.download(remoteUrl, kind);
    return this.persist(brief, kind, loaded.body, loaded.contentType, model);
  }

  private async persistCopy(brief: ProductLaunchBrief, text: string): Promise<ContentAsset> {
    return this.persist(
      brief,
      "copy",
      new TextEncoder().encode(text),
      "text/plain; charset=utf-8",
      "deterministic-commercial-copy-v1",
    );
  }

  private async persist(
    brief: ProductLaunchBrief,
    kind: "image" | "video" | "copy",
    body: Uint8Array,
    contentType: string,
    model: string,
  ): Promise<ContentAsset> {
    enforceMaximum(body.byteLength, this.config.maximumAssetBytes);
    const digest = createHash("sha256").update(body).digest();
    const assetId = `asset_${randomUUID()}`;
    const objectKey = [
      "accounts",
      segment(brief.accountId),
      "generated-content",
      segment(brief.id),
      `${segment(assetId)}.${extensionFor(contentType, kind)}`,
    ].join("/");
    const stored = await this.storage.putGeneratedObject({
      objectKey,
      contentType,
      body,
      checksumSha256Base64: digest.toString("base64"),
      metadata: Object.freeze({
        account: brief.accountId,
        product: brief.id,
        provider: "minimax",
        model,
        prompt: this.config.promptVersion,
        kind,
      }),
    });
    return Object.freeze({
      id: assetId,
      accountId: brief.accountId,
      productId: brief.id,
      kind,
      uri: stored.objectUri,
      contentHash: digest.toString("hex"),
      provider: "minimax",
      model,
      promptVersion: this.config.promptVersion,
      moderationStatus: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  private async download(
    remoteUrl: string,
    kind: "image" | "video",
  ): Promise<Readonly<{ body: Uint8Array; contentType: string }>> {
    const url = new URL(requireHttpsUrl(remoteUrl, `MiniMax ${kind}`));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: `${kind}/*` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`MiniMax ${kind} download failed with HTTP ${response.status}.`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > 0)
        enforceMaximum(declared, this.config.maximumAssetBytes);
      const body = new Uint8Array(await response.arrayBuffer());
      enforceMaximum(body.byteLength, this.config.maximumAssetBytes);
      const contentType = normalizeContentType(response.headers.get("content-type"), kind);
      return Object.freeze({ body, contentType });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MiniMax ${kind} download timed out.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildPrompt(brief: ProductLaunchBrief): string {
  return [
    "Create a faithful professional ecommerce asset for the exact source product.",
    "Do not add logos, certifications, accessories or product features that are not visible.",
    "Use a clean commercial background and preserve proportions, materials and colors.",
    `Source image: ${brief.sourceImageUri}`,
    brief.instructions ? `Owner instructions: ${brief.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function draftCopy(brief: ProductLaunchBrief): string {
  return [
    "Borrador comercial sujeto a revisión humana.",
    `Producto: ${brief.id}.`,
    brief.instructions ? `Instrucciones del dueño: ${brief.instructions}` : "",
    "Complete título, atributos, medidas, compatibilidad y beneficios únicamente con evidencia verificada.",
  ]
    .filter(Boolean)
    .join("\n");
}

function assertProviderSuccess(payload: Record<string, unknown>, operation: string): void {
  const base = record(payload.base_resp);
  const statusCode = base?.status_code;
  if (typeof statusCode === "number" && statusCode !== 0) {
    const message = typeof base?.status_msg === "string" ? base.status_msg : "provider-error";
    throw new Error(`${operation} failed: ${sanitize(message)}.`);
  }
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 0) enforceMaximum(declared, maximumBytes);
  const body = new Uint8Array(await response.arrayBuffer());
  enforceMaximum(body.byteLength, maximumBytes);
  return new TextDecoder().decode(body);
}

function normalizeContentType(value: string | null, kind: "image" | "video"): string {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized.startsWith(`${kind}/`))
    throw new Error(`MiniMax ${kind} returned invalid content type.`);
  return normalized;
}

function extensionFor(contentType: string, kind: "image" | "video" | "copy"): string {
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

function requireHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${label} URL must use HTTPS without embedded credentials or fragments.`);
  }
  return url.toString();
}

function enforceMaximum(value: number, maximum: number): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`MiniMax content exceeds the ${maximum} byte limit.`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function segment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function sanitize(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

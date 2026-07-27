import type { LlmModelId, LlmTokenUsage } from "@eauto/domain";
import type {
  LlmProviderGateway,
  LlmProviderRequest,
  LlmProviderResponse,
} from "@eauto/application";

export class DeepSeekGateway implements LlmProviderGateway {
  constructor(
    private readonly config: Readonly<{
      baseUrl: string;
      apiKey: string;
      fetchImpl?: typeof fetch;
    }>,
  ) {}

  async complete(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await (this.config.fetchImpl ?? fetch)(
        `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            max_tokens: request.maximumOutputTokens,
            temperature: request.temperature,
            response_format: { type: "json_object" },
            stream: false,
          }),
          signal: controller.signal,
        },
      );
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`DeepSeek HTTP ${response.status}: ${sanitizeProviderError(raw)}`);
      }
      const payload = parseResponse(raw);
      if (payload.model !== request.model) {
        throw new Error(`DeepSeek returned model ${payload.model}; expected ${request.model}.`);
      }
      return Object.freeze({
        providerRequestId: payload.id,
        model: payload.model,
        systemFingerprint: payload.systemFingerprint,
        content: payload.content,
        usage: payload.usage,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("DeepSeek request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type ParsedResponse = Readonly<{
  id: string;
  model: LlmModelId;
  systemFingerprint: string | null;
  content: string;
  usage: LlmTokenUsage;
}>;

function parseResponse(raw: string): ParsedResponse {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("DeepSeek returned invalid JSON.");
  }
  const root = requireRecord(value, "response");
  const id = requireString(root.id, "id");
  const model = parseModel(root.model);
  const choices = requireArray(root.choices, "choices");
  const firstChoice = requireRecord(choices[0], "choices[0]");
  const message = requireRecord(firstChoice.message, "choices[0].message");
  const content = requireString(message.content, "choices[0].message.content");
  const usageRecord = requireRecord(root.usage, "usage");
  const promptTokens = requireInteger(usageRecord.prompt_tokens, "usage.prompt_tokens");
  const cacheHitTokens = requireInteger(
    usageRecord.prompt_cache_hit_tokens,
    "usage.prompt_cache_hit_tokens",
  );
  const cacheMissTokens = requireInteger(
    usageRecord.prompt_cache_miss_tokens,
    "usage.prompt_cache_miss_tokens",
  );
  const outputTokens = requireInteger(usageRecord.completion_tokens, "usage.completion_tokens");
  const totalTokens = requireInteger(usageRecord.total_tokens, "usage.total_tokens");
  const completionDetails = isRecord(usageRecord.completion_tokens_details)
    ? usageRecord.completion_tokens_details
    : {};
  const reasoningTokens =
    completionDetails.reasoning_tokens === undefined
      ? 0
      : requireInteger(
          completionDetails.reasoning_tokens,
          "usage.completion_tokens_details.reasoning_tokens",
        );

  return Object.freeze({
    id,
    model,
    systemFingerprint: typeof root.system_fingerprint === "string" ? root.system_fingerprint : null,
    content,
    usage: Object.freeze({
      promptTokens,
      cacheHitTokens,
      cacheMissTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
    }),
  });
}

function parseModel(value: unknown): LlmModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value;
  throw new Error("DeepSeek returned an unsupported model identifier.");
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`DeepSeek field ${field} must be an object.`);
  return value;
}

function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`DeepSeek field ${field} must be a non-empty array.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`DeepSeek field ${field} must be a string.`);
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`DeepSeek field ${field} must be a non-negative integer.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeProviderError(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

import {
  assertShadowAgentOutput,
  assertValidLlmUsage,
  type LlmModelId,
  type LlmRunRecord,
  type LlmTaskClass,
  type LlmTokenUsage,
  type ShadowAgentOutput,
} from "@eauto/domain";
import {
  compilePrompt,
  compileProviderMessages,
  DEEPSEEK_MODEL_PRICING,
  estimateMaximumLlmCost,
  estimateModelCost,
  hash,
  routeLlmModel,
  type PromptCompilerInput,
  type ProviderMessage,
} from "@eauto/agent-kernel";

export type LlmProviderRequest = Readonly<{
  model: LlmModelId;
  messages: readonly ProviderMessage[];
  maximumOutputTokens: number;
  temperature: number;
  responseFormat: "json-object";
  timeoutMs: number;
}>;

export type LlmProviderResponse = Readonly<{
  providerRequestId: string;
  model: LlmModelId;
  systemFingerprint: string | null;
  content: string;
  usage: LlmTokenUsage;
}>;

export interface LlmProviderGateway {
  complete(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}

export interface LlmRunRepository {
  create(record: LlmRunRecord): Promise<void>;
  update(record: LlmRunRecord): Promise<void>;
  get(id: string): Promise<LlmRunRecord | null>;
  list(accountId: string, limit: number): Promise<readonly LlmRunRecord[]>;
  totalActualCostMicrosUsd(input: {
    organizationId: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<number>;
}

export class ShadowLlmService {
  constructor(
    private readonly provider: LlmProviderGateway,
    private readonly repository: LlmRunRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
    private readonly config: Readonly<{
      timeoutMs: number;
      defaultMaximumPromptTokens: number;
      defaultMaximumOutputTokens: number;
      dailyAccountBudgetMicrosUsd: number;
    }>,
  ) {}

  async run(input: {
    organizationId: string;
    accountId: string;
    agentId: string;
    sessionId: string;
    taskClass: LlmTaskClass;
    prompt: PromptCompilerInput;
    inputSchemaVersion: string;
    outputSchemaVersion: string;
    budgetMicrosUsd: number;
    maximumPromptTokens?: number;
    maximumOutputTokens?: number;
  }): Promise<Readonly<{ run: LlmRunRecord; output: ShadowAgentOutput | null }>> {
    const model = routeLlmModel(input.taskClass);
    const maximumPromptTokens = input.maximumPromptTokens ?? this.config.defaultMaximumPromptTokens;
    const maximumOutputTokens = input.maximumOutputTokens ?? this.config.defaultMaximumOutputTokens;
    const estimatedMaximumCostMicrosUsd = estimateMaximumLlmCost({
      model,
      maximumPromptTokens,
      maximumOutputTokens,
    });
    validateBudget(input.budgetMicrosUsd, "budgetMicrosUsd");
    const now = this.clock.now();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const periodEnd = new Date(Date.parse(periodStart) + 86_400_000).toISOString();
    const spentToday = await this.repository.totalActualCostMicrosUsd({
      organizationId: input.organizationId,
      accountId: input.accountId,
      periodStart,
      periodEnd,
    });
    const compiled = compilePrompt(input.prompt);
    const id = this.ids.next("llm-run");
    const createdAt = now.toISOString();
    const blocked =
      estimatedMaximumCostMicrosUsd > input.budgetMicrosUsd ||
      spentToday + estimatedMaximumCostMicrosUsd > this.config.dailyAccountBudgetMicrosUsd;
    const prepared = Object.freeze({
      id,
      organizationId: input.organizationId,
      accountId: input.accountId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      taskClass: input.taskClass,
      provider: "deepseek" as const,
      model,
      mode: "shadow" as const,
      status: blocked ? ("blocked" as const) : ("prepared" as const),
      stablePrefixHash: compiled.stableHash,
      fullPromptHash: compiled.fullHash,
      inputSchemaVersion: input.inputSchemaVersion,
      outputSchemaVersion: input.outputSchemaVersion,
      budgetMicrosUsd: input.budgetMicrosUsd,
      estimatedMaximumCostMicrosUsd,
      actualCostMicrosUsd: null,
      usage: null,
      cacheHitRatioBps: null,
      providerRequestId: null,
      systemFingerprint: null,
      outputHash: null,
      outputJson: null,
      startedAt: null,
      completedAt: blocked ? createdAt : null,
      failureReason: blocked ? "llm-budget-gate" : null,
      createdAt,
      updatedAt: createdAt,
    } satisfies LlmRunRecord);
    await this.repository.create(prepared);
    if (blocked) return { run: prepared, output: null };

    const startedAt = this.clock.now().toISOString();
    const running = Object.freeze({
      ...prepared,
      status: "running" as const,
      startedAt,
      updatedAt: startedAt,
    });
    await this.repository.update(running);

    try {
      const response = await this.provider.complete({
        model,
        messages: compileProviderMessages(compiled),
        maximumOutputTokens,
        temperature: 0,
        responseFormat: "json-object",
        timeoutMs: this.config.timeoutMs,
      });
      if (response.model !== model) {
        throw new Error(`Provider returned model ${response.model}; expected ${model}.`);
      }
      assertValidLlmUsage(response.usage);
      const parsed = parseJsonObject(response.content);
      assertShadowAgentOutput(parsed);
      const actualCostMicrosUsd = estimateModelCost(DEEPSEEK_MODEL_PRICING[model], {
        cacheHitTokens: response.usage.cacheHitTokens,
        cacheMissTokens: response.usage.cacheMissTokens,
        outputTokens: response.usage.outputTokens,
      });
      if (actualCostMicrosUsd > input.budgetMicrosUsd) {
        throw new Error("Provider response exceeded the per-run budget.");
      }
      const completedAt = this.clock.now().toISOString();
      const completed = Object.freeze({
        ...running,
        status: "completed" as const,
        actualCostMicrosUsd,
        usage: response.usage,
        cacheHitRatioBps:
          response.usage.promptTokens === 0
            ? 0
            : Math.round((response.usage.cacheHitTokens * 10_000) / response.usage.promptTokens),
        providerRequestId: response.providerRequestId,
        systemFingerprint: response.systemFingerprint,
        outputHash: hash(response.content),
        outputJson: parsed,
        completedAt,
        updatedAt: completedAt,
      } satisfies LlmRunRecord);
      await this.repository.update(completed);
      return { run: completed, output: parsed };
    } catch (error) {
      const completedAt = this.clock.now().toISOString();
      const failed = Object.freeze({
        ...running,
        status: "failed" as const,
        completedAt,
        failureReason: sanitizeError(error),
        updatedAt: completedAt,
      } satisfies LlmRunRecord);
      await this.repository.update(failed);
      return { run: failed, output: null };
    }
  }

  list(accountId: string, limit = 100): Promise<readonly LlmRunRecord[]> {
    return this.repository.list(accountId, Math.min(500, Math.max(1, limit)));
  }
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("Provider did not return one JSON object.");
  }
  return JSON.parse(trimmed) as unknown;
}

function validateBudget(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer in micro-USD.`);
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown LLM gateway error";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

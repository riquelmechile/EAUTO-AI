import { describe, expect, it } from "vitest";
import type { LlmProviderGateway, LlmProviderRequest } from "@eauto/application";
import { ShadowLlmService } from "@eauto/application";
import {
  DEEPSEEK_MODEL_PRICING,
  compilePrompt,
  estimateMaximumLlmCost,
  estimateModelCost,
  routeLlmModel,
} from "@eauto/agent-kernel";
import { DeepSeekGateway, InMemoryLlmRunRepository } from "@eauto/infrastructure";

const prompt = {
  constitution: "constitution-v1",
  globalSafetyPolicy: "safety-v1",
  toolContract: "no tools",
  agentIdentity: "pricing@1.0.0",
  accountPolicy: "plasticov-MLC-v1",
  skillManifest: "economic-truth@1.0.0",
  recoveredContext: "evidence: margin and listing snapshots",
  volatileInput: "Analyze current pricing and return JSON.",
};

describe("DeepSeek pricing and routing", () => {
  it("routes simple tasks to Flash and critical tasks to Pro", () => {
    expect(routeLlmModel("classification")).toBe("deepseek-v4-flash");
    expect(routeLlmModel("critical-review")).toBe("deepseek-v4-pro");
  });

  it("prices cache hit, cache miss and output independently in micro-USD", () => {
    expect(
      estimateModelCost(DEEPSEEK_MODEL_PRICING["deepseek-v4-flash"], {
        cacheHitTokens: 1_000_000,
        cacheMissTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(422_800);
    expect(
      estimateMaximumLlmCost({
        model: "deepseek-v4-pro",
        maximumPromptTokens: 10_000,
        maximumOutputTokens: 1_000,
      }),
    ).toBe(5_220);
  });

  it("keeps the stable prefix hash unchanged when only volatile work changes", () => {
    const first = compilePrompt(prompt);
    const second = compilePrompt({ ...prompt, volatileInput: "A different current task." });
    expect(first.stableHash).toBe(second.stableHash);
    expect(first.fullHash).not.toBe(second.fullHash);
  });
});

describe("DeepSeek gateway usage parsing", () => {
  it("uses official prompt cache hit and miss fields", async () => {
    const gateway = new DeepSeekGateway({
      baseUrl: "https://api.deepseek.test",
      apiKey: "secret",
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "request-1",
              model: "deepseek-v4-flash",
              system_fingerprint: "fp-1",
              choices: [{ message: { content: '{"summary":"ok"}' } }],
              usage: {
                prompt_tokens: 100,
                prompt_cache_hit_tokens: 80,
                prompt_cache_miss_tokens: 20,
                completion_tokens: 10,
                total_tokens: 110,
                completion_tokens_details: { reasoning_tokens: 2 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    });
    await expect(
      gateway.complete({
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: "stable" }],
        maximumOutputTokens: 100,
        temperature: 0,
        responseFormat: "json-object",
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      usage: {
        promptTokens: 100,
        cacheHitTokens: 80,
        cacheMissTokens: 20,
        outputTokens: 10,
        reasoningTokens: 2,
        totalTokens: 110,
      },
    });
  });

  it("rejects responses that omit official cache fields", async () => {
    const gateway = new DeepSeekGateway({
      baseUrl: "https://api.deepseek.test",
      apiKey: "secret",
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "request-1",
              model: "deepseek-v4-flash",
              choices: [{ message: { content: "{}" } }],
              usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
            }),
            { status: 200 },
          ),
        ),
    });
    await expect(
      gateway.complete({
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: "stable" }],
        maximumOutputTokens: 100,
        temperature: 0,
        responseFormat: "json-object",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/prompt_cache_hit_tokens/);
  });
});

describe("Shadow LLM service", () => {
  it("blocks before the provider when the worst-case cost exceeds budget", async () => {
    let calls = 0;
    const provider: LlmProviderGateway = {
      complete: () => {
        calls += 1;
        return Promise.reject(new Error("must not call provider"));
      },
    };
    const service = createService(provider, 10_000_000);
    const result = await service.run({
      organizationId: "maustian",
      accountId: "plasticov",
      agentId: "pricing",
      sessionId: "session-1",
      taskClass: "analysis",
      prompt,
      inputSchemaVersion: "input-v1",
      outputSchemaVersion: "shadow-output-v1",
      budgetMicrosUsd: 1,
      maximumPromptTokens: 10_000,
      maximumOutputTokens: 1_000,
    });
    expect(result.run.status).toBe("blocked");
    expect(result.output).toBeNull();
    expect(calls).toBe(0);
  });

  it("persists a valid JSON shadow result with cache telemetry and no execution", async () => {
    const provider: LlmProviderGateway = {
      complete: (request: LlmProviderRequest) =>
        Promise.resolve({
          providerRequestId: "request-1",
          model: request.model,
          systemFingerprint: "fp-1",
          content: JSON.stringify({
            summary: "Pricing requires review.",
            findings: [
              {
                statement: "Margin evidence is available.",
                evidenceRefs: ["evidence:margin"],
                confidence: "high",
              },
            ],
            proposals: [
              {
                action: "proposal.create",
                rationale: "Prepare a price review; do not execute it.",
                evidenceRefs: ["evidence:margin"],
                expectedImpactMinorClp: 10_000,
                risk: "high",
                requiresHumanApproval: true,
              },
            ],
            missingEvidenceKinds: [],
            stopReason: "completed",
          }),
          usage: {
            promptTokens: 100,
            cacheHitTokens: 80,
            cacheMissTokens: 20,
            outputTokens: 40,
            reasoningTokens: 5,
            totalTokens: 140,
          },
        }),
    };
    const service = createService(provider, 10_000_000);
    const result = await service.run({
      organizationId: "maustian",
      accountId: "plasticov",
      agentId: "pricing",
      sessionId: "session-1",
      taskClass: "analysis",
      prompt,
      inputSchemaVersion: "input-v1",
      outputSchemaVersion: "shadow-output-v1",
      budgetMicrosUsd: 10_000,
      maximumPromptTokens: 1_000,
      maximumOutputTokens: 500,
    });
    expect(result.run.status).toBe("completed");
    expect(result.run.cacheHitRatioBps).toBe(8_000);
    expect(result.run.actualCostMicrosUsd).toBeGreaterThan(0);
    expect(result.output?.proposals[0]?.requiresHumanApproval).toBe(true);
  });
});

function createService(provider: LlmProviderGateway, dailyBudget: number) {
  let sequence = 0;
  return new ShadowLlmService(
    provider,
    new InMemoryLlmRunRepository(),
    { now: () => new Date("2026-07-27T10:00:00.000Z") },
    { next: (prefix) => `${prefix}-${++sequence}` },
    {
      timeoutMs: 5_000,
      defaultMaximumPromptTokens: 10_000,
      defaultMaximumOutputTokens: 1_000,
      dailyAccountBudgetMicrosUsd: dailyBudget,
    },
  );
}

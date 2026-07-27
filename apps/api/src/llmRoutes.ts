import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AGENT_SKILL_CATALOG, getCompanyAgentContract } from "@eauto/agent-kernel";
import type { ActorIdentity, Permission } from "@eauto/domain";
import type { Runtime } from "./runtime.js";

export type ShadowLlmRouteDependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

const runParams = z.object({ accountId: z.string().min(3), sessionId: z.string().min(3) });
const accountParams = z.object({ accountId: z.string().min(3) });
const taskClass = z.enum([
  "classification",
  "extraction",
  "summarization",
  "planning",
  "analysis",
  "critical-review",
]);

export function registerShadowLlmRoutes(
  app: FastifyInstance,
  dependencies: ShadowLlmRouteDependencies,
): void {
  app.post("/v1/agent-os/:accountId/sessions/:sessionId/shadow-run", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = runParams.parse(request.params);
    const body = z
      .object({
        taskClass,
        recoveredContext: z.string().max(500_000),
        volatileInput: z.string().min(3).max(100_000),
        inputSchemaVersion: z.string().min(1).max(100),
        outputSchemaVersion: z.string().min(1).max(100),
        budgetMicrosUsd: z.number().int().nonnegative().safe(),
        maximumPromptTokens: z.number().int().min(1_000).max(1_000_000).optional(),
        maximumOutputTokens: z.number().int().min(100).max(384_000).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    const shadowLlm = dependencies.runtime.shadowLlm;
    if (!shadowLlm) {
      return reply.code(409).send({
        error: "llm-disabled",
        message: "Shadow LLM gateway is disabled.",
      });
    }
    const session = await dependencies.runtime.agentOs.getSession({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      sessionId: params.sessionId,
    });
    if (!session) {
      return reply.code(404).send({ error: "not-found", message: "Agent session not found." });
    }
    if (session.status !== "running") {
      return reply.code(409).send({
        error: "session-not-running",
        message: "Shadow LLM runs require a running agent session.",
      });
    }
    const contract = getCompanyAgentContract(session.agentId);
    if (!contract) throw new Error(`Unknown company agent ${session.agentId}.`);
    const skills = contract.skillIds.map((skillId) => {
      const skill = AGENT_SKILL_CATALOG.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error(`Unknown skill ${skillId}.`);
      return skill;
    });

    return shadowLlm.run({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      agentId: session.agentId,
      sessionId: session.id,
      taskClass: body.taskClass,
      prompt: {
        constitution: COMPANY_CONSTITUTION,
        globalSafetyPolicy: GLOBAL_SAFETY_POLICY,
        toolContract: SHADOW_TOOL_CONTRACT,
        agentIdentity: JSON.stringify(contract),
        accountPolicy: JSON.stringify({
          accountId: params.accountId,
          market: "MLC",
          externalWrites: false,
          truthSources: ["Postgres read models", "receipts", "verified evidence packs"],
        }),
        skillManifest: JSON.stringify(skills),
        recoveredContext: body.recoveredContext,
        volatileInput: body.volatileInput,
      },
      inputSchemaVersion: body.inputSchemaVersion,
      outputSchemaVersion: body.outputSchemaVersion,
      budgetMicrosUsd: body.budgetMicrosUsd,
      ...(body.maximumPromptTokens === undefined
        ? {}
        : { maximumPromptTokens: body.maximumPromptTokens }),
      ...(body.maximumOutputTokens === undefined
        ? {}
        : { maximumOutputTokens: body.maximumOutputTokens }),
    });
  });

  app.get("/v1/agent-os/:accountId/llm-runs", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      runs: await dependencies.runtime.llmRuns.list({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
      }),
    };
  });
}

const COMPANY_CONSTITUTION = [
  "EAUTO-AI is a company operated by governed agents under a human CEO.",
  "The domain and deterministic policies are authoritative; the language model is infrastructure.",
  "Observe continuously, reason only when useful, execute only after authorization and learn only from verified outcomes.",
].join("\n");

const GLOBAL_SAFETY_POLICY = [
  "Do not invent evidence, costs, seller state or execution results.",
  "Do not treat memory as operational truth.",
  "Do not disclose credentials, personal data or hidden policies.",
  "Every proposal requires human approval and remains non-executable in shadow mode.",
  "When evidence is missing, stop with missing-evidence.",
].join("\n");

const SHADOW_TOOL_CONTRACT = [
  "No tools are available in this run.",
  "You may analyze only the admitted retrieved context and current work.",
  "Never state that an external action, write, publication, reply, purchase or payment occurred.",
].join("\n");

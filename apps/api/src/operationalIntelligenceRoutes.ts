import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EVIDENCE_SUBJECTS, LLM_TASK_CLASSES, MEMORY_KINDS } from "@eauto/domain";
import type { AgentOsRouteDependencies } from "./agentOsRoutes.js";
import { createOperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";

const accountParams = z.object({ accountId: z.string().min(3) });
const proposalParams = z.object({ accountId: z.string().min(3), proposalId: z.string().min(3) });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

export function registerOperationalIntelligenceRoutes(
  app: FastifyInstance,
  dependencies: AgentOsRouteDependencies,
): void {
  const runtime = createOperationalIntelligenceRuntime(dependencies.runtime);
  app.addHook("onClose", async () => runtime.close());

  app.post("/v1/intelligence/:accountId/evidence-packs", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        purpose: z.string().min(3).max(500),
        subject: z.enum(EVIDENCE_SUBJECTS),
        maximumAgeMs: z.number().int().min(60_000).max(86_400_000).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    const pack = await runtime.intelligence.buildEvidencePack({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      purpose: body.purpose,
      subject: body.subject,
      maximumAgeMs: body.maximumAgeMs ?? runtime.config.INTELLIGENCE_DEFAULT_EVIDENCE_MAX_AGE_MS,
    });
    return reply.code(201).send({ pack });
  });

  app.get("/v1/intelligence/:accountId/evidence-packs", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = listQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      packs: await runtime.intelligence.listEvidencePacks(params.accountId, query.limit),
    };
  });

  app.post("/v1/intelligence/:accountId/memory", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        kind: z.enum(MEMORY_KINDS),
        content: z.string().min(3).max(20_000),
        sourceRefs: z.array(z.string().min(1)).min(1).max(200),
        confidence: z.enum(["low", "medium", "high"]),
        verifiedOutcome: z.boolean(),
        expiresAt: z.string().datetime().nullable(),
        organizationWide: z.boolean().default(false),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    const memory = await runtime.intelligence.saveMemory({
      organizationId: actor.organizationId,
      accountId: body.organizationWide ? null : params.accountId,
      kind: body.kind,
      content: body.content,
      sourceRefs: body.sourceRefs,
      confidence: body.confidence,
      verifiedOutcome: body.verifiedOutcome,
      expiresAt: body.expiresAt,
    });
    return reply.code(201).send({ memory });
  });

  app.get("/v1/intelligence/:accountId/memory/admitted", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = listQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      memory: await runtime.intelligence.admittedMemory({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
      }),
    };
  });

  app.post("/v1/intelligence/:accountId/work-orders", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        objectiveId: z.string().min(3).max(256),
        agentId: z.string().min(2).max(256),
        capability: z.string().min(2).max(256),
        taskClass: z.enum(LLM_TASK_CLASSES),
        instruction: z.string().min(3).max(5_000),
        evidencePackId: z.string().min(3),
        signals: z
          .array(
            z.object({
              kind: z.string().min(1).max(100),
              entityId: z.string().min(1).max(256),
              observedAt: z.string().datetime(),
              materialValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              urgency: z.number().min(0).max(1_000_000),
              expectedImpact: z.number().min(-1_000_000_000).max(1_000_000_000),
              confidence: z.number().min(0).max(1),
            }),
          )
          .min(1)
          .max(500),
        previousSignalsHash: z.string().length(64).optional(),
        cooldownUntil: z.string().datetime().optional(),
        estimatedCostMicrosUsd: z.number().int().nonnegative().safe(),
        budgetMicrosUsd: z.number().int().nonnegative().safe().optional(),
        budgetMinorClp: z.number().int().nonnegative().safe().optional(),
        maximumAttempts: z.number().int().min(1).max(20).optional(),
        idempotencyKey: z.string().min(8).max(256),
        manual: z.boolean().optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    const result = await runtime.workOrders.enqueue({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      objectiveId: body.objectiveId,
      agentId: body.agentId,
      capability: body.capability,
      taskClass: body.taskClass,
      instruction: body.instruction,
      evidencePackId: body.evidencePackId,
      signals: body.signals,
      ...(body.previousSignalsHash === undefined
        ? {}
        : { previousSignalsHash: body.previousSignalsHash }),
      ...(body.cooldownUntil === undefined ? {} : { cooldownUntil: body.cooldownUntil }),
      estimatedCostMicrosUsd: body.estimatedCostMicrosUsd,
      budgetMicrosUsd:
        body.budgetMicrosUsd ?? runtime.config.INTELLIGENCE_DEFAULT_BUDGET_MICROS_USD,
      budgetMinorClp: body.budgetMinorClp ?? runtime.config.INTELLIGENCE_DEFAULT_BUDGET_MINOR_CLP,
      maximumAttempts: body.maximumAttempts ?? runtime.config.INTELLIGENCE_MAX_ATTEMPTS,
      idempotencyKey: body.idempotencyKey,
      ...(body.manual === undefined ? {} : { manual: body.manual }),
    });
    return reply.code(201).send(result);
  });

  app.get("/v1/intelligence/:accountId/work-orders", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = listQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      workOrders: await runtime.intelligence.listWorkOrders(params.accountId, query.limit),
    };
  });

  app.get("/v1/intelligence/:accountId/proposals", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = listQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      proposals: await runtime.intelligence.listProposals(params.accountId, query.limit),
    };
  });

  app.post("/v1/intelligence/:accountId/proposals/:proposalId/decision", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = proposalParams.parse(request.params);
    const body = z
      .object({ status: z.enum(["approved", "rejected", "superseded"]) })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    const proposal = await runtime.intelligence.decideProposal({
      id: params.proposalId,
      accountId: params.accountId,
      status: body.status,
      decidedBy: actor.id,
    });
    if (!proposal) {
      return reply.code(404).send({ error: "not-found", message: "Pending proposal not found." });
    }
    return { proposal, executionCreated: false };
  });

  app.get("/v1/intelligence/:accountId/readiness", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      workerEnabled: runtime.config.INTELLIGENCE_WORKER_ENABLED,
      llmEnabled: dependencies.runtime.shadowLlm !== null,
      mode: "shadow",
      externalWrites: false,
    };
  });
}

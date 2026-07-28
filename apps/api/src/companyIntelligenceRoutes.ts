import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AGENT_MESSAGE_KINDS,
  PRODUCT_LIFECYCLE_STATES,
  SPECIALIST_DAEMON_IDS,
  SUPPLY_WORKFLOW_KINDS,
  type ActorIdentity,
  type Permission,
} from "@eauto/domain";
import type { CompanyIntelligenceRuntime } from "./companyIntelligenceRuntime.js";

export type CompanyIntelligenceRouteDependencies = Readonly<{
  runtime: CompanyIntelligenceRuntime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

const accountParams = z.object({ accountId: z.string().min(3).max(128) });
const idParams = z.object({ accountId: z.string().min(3).max(128), id: z.string().min(3).max(256) });
const listingParams = z.object({
  accountId: z.string().min(3).max(128),
  listingId: z.string().min(3).max(256),
});
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(1_000).default(100) });

export function registerCompanyIntelligenceRoutes(
  app: FastifyInstance,
  dependencies: CompanyIntelligenceRouteDependencies,
): void {
  app.post("/v1/company/:accountId/messages", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        idempotencyKey: z.string().min(8).max(256),
        conversationId: z.string().min(3).max(256).optional(),
        correlationId: z.string().min(3).max(256).optional(),
        causationId: z.string().min(3).max(256).optional(),
        senderAgentId: z.string().min(2).max(128),
        recipientAgentId: z.string().min(2).max(128),
        kind: z.enum(AGENT_MESSAGE_KINDS),
        subject: z.string().min(1).max(256),
        payload: z.unknown(),
        evidenceRefs: z.array(z.string().min(1).max(512)).max(200).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return reply.code(201).send(
      await dependencies.runtime.messages.publish({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...body,
      }),
    );
  });

  app.get("/v1/company/:accountId/messages", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.extend({ conversationId: z.string().min(3).max(256).optional() }).parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      messages: await dependencies.runtime.messages.list({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...query,
      }),
    };
  });

  app.post("/v1/company/:accountId/evidence/requests", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        idempotencyKey: z.string().min(8).max(256),
        conversationId: z.string().min(3).max(256),
        correlationId: z.string().min(3).max(256),
        requesterAgentId: z.string().min(2).max(128),
        responderId: z.string().min(2).max(128).optional(),
        subject: z.enum(["catalog", "customer", "commercial", "economic", "reputation", "content", "system"]),
        purpose: z.string().min(3).max(1_000),
        requiredKinds: z.array(z.string().min(1).max(128)).max(100).optional(),
        maximumAgeMs: z.number().int().min(60_000).max(86_400_000),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return reply.code(202).send(
      await dependencies.runtime.evidenceRouter.request({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...body,
      }),
    );
  });

  app.get("/v1/company/:accountId/evidence/requests/:id/response", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = idParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const response = await dependencies.runtime.repository.getEvidenceResponse({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      requestId: params.id,
    });
    return response ? response : reply.code(404).send({ error: "evidence-response-not-found" });
  });

  app.post("/v1/company/:accountId/memory", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        global: z.boolean().default(false),
        topicKey: z.string().min(2).max(256),
        title: z.string().min(2).max(300),
        observation: z.string().min(3).max(10_000),
        rationale: z.string().min(3).max(10_000),
        scopeDescription: z.string().min(3).max(2_000),
        keywords: z.array(z.string().min(1).max(100)).max(100).optional(),
        sourceRefs: z.array(z.string().min(1).max(512)).min(1).max(200),
        confidence: z.enum(["low", "medium", "high"]),
        verifiedOutcome: z.boolean().default(false),
        expiresAt: z.string().datetime().optional(),
        supersedesId: z.string().min(3).max(256).optional(),
        conflictsWithIds: z.array(z.string().min(3).max(256)).max(100).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    return reply.code(201).send(
      await dependencies.runtime.memory.remember({
        organizationId: actor.organizationId,
        accountId: body.global ? null : params.accountId,
        topicKey: body.topicKey,
        title: body.title,
        observation: body.observation,
        rationale: body.rationale,
        scopeDescription: body.scopeDescription,
        sourceRefs: body.sourceRefs,
        confidence: body.confidence,
        verifiedOutcome: body.verifiedOutcome,
        ...(body.keywords ? { keywords: body.keywords } : {}),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        ...(body.supersedesId ? { supersedesId: body.supersedesId } : {}),
        ...(body.conflictsWithIds ? { conflictsWithIds: body.conflictsWithIds } : {}),
      }),
    );
  });

  app.get("/v1/company/:accountId/memory/search", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery
      .extend({ query: z.string().min(2).max(1_000), requireVerifiedOutcome: z.coerce.boolean().default(false) })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      results: await dependencies.runtime.memory.retrieve({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        query: query.query,
        limit: query.limit,
        requireVerifiedOutcome: query.requireVerifiedOutcome,
      }),
    };
  });

  app.get("/v1/company/:accountId/memory/topics/:id", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = idParams.parse(request.params);
    const query = limitQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      entries: await dependencies.runtime.memory.history({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        topicKey: params.id,
        limit: query.limit,
      }),
    };
  });

  app.post("/v1/company/:accountId/brain/rebuild", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z.object({ maximumAgeMs: z.number().int().min(60_000).max(86_400_000) }).parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.accountBrain.rebuild({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      maximumAgeMs: body.maximumAgeMs,
    });
  });

  app.get("/v1/company/:accountId/brain", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const snapshot = await dependencies.runtime.accountBrain.latest({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return snapshot ? snapshot : reply.code(404).send({ error: "account-brain-not-found" });
  });

  app.post("/v1/company/:accountId/daemons/initialize", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    await dependencies.runtime.daemons.initialize({ organizationId: actor.organizationId, accountId: params.accountId });
    return reply.code(204).send();
  });

  app.get("/v1/company/:accountId/daemons", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      catalog: SPECIALIST_DAEMON_IDS,
      states: await dependencies.runtime.daemons.listStates({
        organizationId: actor.organizationId,
        accountId: params.accountId,
      }),
    };
  });

  app.get("/v1/company/:accountId/daemons/runs", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.extend({ daemonId: z.enum(SPECIALIST_DAEMON_IDS).optional() }).parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      runs: await dependencies.runtime.daemons.listRuns({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
        ...(query.daemonId ? { daemonId: query.daemonId } : {}),
      }),
    };
  });

  app.post("/v1/company/:accountId/supply/workflows", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        kind: z.enum(SUPPLY_WORKFLOW_KINDS),
        supplierId: z.string().min(1).max(256),
        listingId: z.string().min(1).max(256).nullable(),
        idempotencyKey: z.string().min(8).max(256),
        evidenceRefs: z.array(z.string().min(1).max(512)).max(200).default([]),
        parameters: z.object({
          maximumAgeMs: z.number().int().min(60_000).max(86_400_000),
          stockFloor: z.number().int().nonnegative().nullable().default(null),
          stockCeiling: z.number().int().nonnegative().nullable().default(null),
          maximumPurchaseQuantity: z.number().int().positive().nullable().default(null),
          maximumUnitCostMinorClp: z.number().int().nonnegative().safe().nullable().default(null),
          reason: z.string().min(3).max(2_000),
        }),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return reply.code(201).send(
      await dependencies.runtime.supply.run({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        requestedBy: actor.id,
        dryRun: true,
        ...body,
      }),
    );
  });

  app.get("/v1/company/:accountId/supply/workflows", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      workflows: await dependencies.runtime.supply.list({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
      }),
    };
  });

  app.get("/v1/company/:accountId/supply/workflows/:id", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = idParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const workflow = await dependencies.runtime.supply.get({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      id: params.id,
    });
    return workflow ? workflow : reply.code(404).send({ error: "supply-workflow-not-found" });
  });

  app.post("/v1/company/:accountId/lifecycle/:listingId/assess", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = listingParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return dependencies.runtime.lifecycle.assess({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      listingId: params.listingId,
    });
  });

  app.post("/v1/company/:accountId/lifecycle/assess", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z.object({ limit: z.number().int().min(1).max(1_000).optional() }).parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return {
      assessments: await dependencies.runtime.lifecycle.assessPortfolio({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...(body.limit ? { limit: body.limit } : {}),
      }),
    };
  });

  app.get("/v1/company/:accountId/lifecycle", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.extend({ state: z.enum(PRODUCT_LIFECYCLE_STATES).optional() }).parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return {
      assessments: await dependencies.runtime.lifecycle.list({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
        ...(query.state ? { state: query.state } : {}),
      }),
    };
  });

  app.get("/v1/company/:accountId/lifecycle/:listingId", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = listingParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    const assessment = await dependencies.runtime.lifecycle.latest({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      listingId: params.listingId,
    });
    return assessment ? assessment : reply.code(404).send({ error: "lifecycle-not-found" });
  });

  registerEconomicRoutes(app, dependencies);
}

function registerEconomicRoutes(
  app: FastifyInstance,
  dependencies: CompanyIntelligenceRouteDependencies,
): void {
  const economic = () => {
    if (!dependencies.runtime.economic) throw new Error("Economic operations require PostgreSQL.");
    return dependencies.runtime.economic;
  };

  app.get("/v1/company/:accountId/economic/status", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return economic().status({ organizationId: actor.organizationId, accountId: params.accountId });
  });

  app.get("/v1/company/:accountId/economic/coverage", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return { rows: await economic().coverage({ organizationId: actor.organizationId, accountId: params.accountId, limit: query.limit }) };
  });

  app.get("/v1/company/:accountId/economic/missing", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = limitQuery.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    return { rows: await economic().missing({ organizationId: actor.organizationId, accountId: params.accountId, limit: query.limit }) };
  });

  app.get("/v1/company/:accountId/economic/evidence/:listingId", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = listingParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "analytics.read");
    const evidence = await economic().inspectEvidence({ organizationId: actor.organizationId, accountId: params.accountId, listingId: params.listingId });
    return evidence ? evidence : reply.code(404).send({ error: "economic-evidence-not-found" });
  });

  app.post("/v1/company/:accountId/economic/ingest", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z.object({ listingId: z.string().min(3).max(256).optional(), limit: z.number().int().min(1).max(10_000).optional() }).parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "operations.manage");
    return economic().ingest({ organizationId: actor.organizationId, accountId: params.accountId, ...body });
  });

  app.post("/v1/company/:accountId/economic/reconcile", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z.object({ listingId: z.string().min(3).max(256).optional(), limit: z.number().int().min(1).max(10_000).optional() }).parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "operations.manage");
    return { rows: await economic().reconcile({ organizationId: actor.organizationId, accountId: params.accountId, ...body }) };
  });
}

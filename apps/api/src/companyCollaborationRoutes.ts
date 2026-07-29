import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AGENT_MESSAGE_KINDS } from "@eauto/domain";
import {
  accountParamsSchema,
  limitQuerySchema,
  queryBoolean,
  resourceParamsSchema,
  type CompanyRouteDependencies,
} from "./companyRouteSupport.js";

const evidenceSubjectSchema = z.enum([
  "catalog",
  "customer",
  "commercial",
  "economic",
  "reputation",
  "content",
  "system",
]);

export function registerCompanyCollaborationRoutes(
  app: FastifyInstance,
  dependencies: CompanyRouteDependencies,
): void {
  app.post("/v1/company/:accountId/messages", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
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
        idempotencyKey: body.idempotencyKey,
        senderAgentId: body.senderAgentId,
        recipientAgentId: body.recipientAgentId,
        kind: body.kind,
        subject: body.subject,
        payload: body.payload,
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
        ...(body.correlationId ? { correlationId: body.correlationId } : {}),
        ...(body.causationId ? { causationId: body.causationId } : {}),
        ...(body.evidenceRefs ? { evidenceRefs: body.evidenceRefs } : {}),
      }),
    );
  });

  app.get("/v1/company/:accountId/messages", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema
      .extend({ conversationId: z.string().min(3).max(256).optional() })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      messages: await dependencies.runtime.messages.list({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      }),
    };
  });

  app.post("/v1/company/:accountId/evidence/requests", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const body = z
      .object({
        idempotencyKey: z.string().min(8).max(256),
        conversationId: z.string().min(3).max(256),
        correlationId: z.string().min(3).max(256),
        requesterAgentId: z.string().min(2).max(128),
        responderId: z.string().min(2).max(128).optional(),
        subject: evidenceSubjectSchema,
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
        idempotencyKey: body.idempotencyKey,
        conversationId: body.conversationId,
        correlationId: body.correlationId,
        requesterAgentId: body.requesterAgentId,
        subject: body.subject,
        purpose: body.purpose,
        maximumAgeMs: body.maximumAgeMs,
        ...(body.responderId ? { responderId: body.responderId } : {}),
        ...(body.requiredKinds ? { requiredKinds: body.requiredKinds } : {}),
      }),
    );
  });

  app.get("/v1/company/:accountId/evidence/requests/:id/response", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = resourceParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const response = await dependencies.runtime.repository.getEvidenceResponse({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      requestId: params.id,
    });
    return response ?? reply.code(404).send({ error: "evidence-response-not-found" });
  });

  app.post("/v1/company/:accountId/memory", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
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
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema
      .extend({
        query: z.string().min(2).max(1_000),
        requireVerifiedOutcome: queryBoolean.default(false),
      })
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
    const params = resourceParamsSchema.parse(request.params);
    const query = limitQuerySchema.parse(request.query);
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
}

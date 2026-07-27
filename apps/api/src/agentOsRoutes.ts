import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission } from "@eauto/domain";
import { registerShadowLlmRoutes } from "./llmRoutes.js";
import type { Runtime } from "./runtime.js";

export type AgentOsRouteDependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

const accountParams = z.object({ accountId: z.string().min(3) });
const sessionParams = z.object({ accountId: z.string().min(3), sessionId: z.string().min(3) });
const accountQuery = z.object({ accountId: z.string().min(3) });
const autonomy = z.enum(["ask", "inform", "autonomous"]);

export function registerAgentOsRoutes(
  app: FastifyInstance,
  dependencies: AgentOsRouteDependencies,
): void {
  registerShadowLlmRoutes(app, dependencies);

  app.get("/v1/agent-os/catalog", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = accountQuery.parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "agents.read");
    return dependencies.runtime.agentOs.catalog();
  });

  app.post("/v1/agent-os/:accountId/plans/company", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        objective: z.string().min(3).max(5_000),
        maximumTasks: z.number().int().min(1).max(5).optional(),
        budgetMinorClp: z.number().int().nonnegative().safe().optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.planCompany({
      objective: body.objective,
      ...(body.maximumTasks === undefined ? {} : { maximumTasks: body.maximumTasks }),
      ...(body.budgetMinorClp === undefined ? {} : { budgetMinorClp: body.budgetMinorClp }),
    });
  });

  app.post("/v1/agent-os/:accountId/plans/department", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        directorAgentId: z.string().min(3),
        objective: z.string().min(3).max(5_000),
        maximumTasks: z.number().int().min(1).max(5).optional(),
        budgetMinorClp: z.number().int().nonnegative().safe().optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.planDepartment({
      directorAgentId: body.directorAgentId,
      objective: body.objective,
      ...(body.maximumTasks === undefined ? {} : { maximumTasks: body.maximumTasks }),
      ...(body.budgetMinorClp === undefined ? {} : { budgetMinorClp: body.budgetMinorClp }),
    });
  });

  app.post("/v1/agent-os/:accountId/preflight", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = preflightSchema().parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.preflight({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      ...body,
    });
  });

  app.post("/v1/agent-os/:accountId/sessions", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const body = z
      .object({
        objectiveId: z.string().min(3),
        agentId: z.string().min(2),
        parentSessionId: z.string().min(3).nullable().optional(),
        requestedAction: z.string().min(3),
        availableEvidenceKinds: z.array(z.string().min(1)).max(100),
        evidenceRefs: z.array(z.string().min(1)).max(200),
        autonomy,
        requestedBudgetMinorClp: z.number().int().nonnegative().safe(),
        spentTodayMinorClp: z.number().int().nonnegative().safe(),
        policyAllowed: z.boolean(),
        stableContextRefs: z.array(z.string().min(1)).max(100),
        volatileContextRefs: z.array(z.string().min(1)).max(100),
        idempotencyKey: z.string().min(8).max(256),
        deadlineAt: z.string().datetime(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    const result = await dependencies.runtime.agentOs.createSession({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      objectiveId: body.objectiveId,
      agentId: body.agentId,
      ...(body.parentSessionId === undefined ? {} : { parentSessionId: body.parentSessionId }),
      requestedAction: body.requestedAction,
      availableEvidenceKinds: body.availableEvidenceKinds,
      evidenceRefs: body.evidenceRefs,
      autonomy: body.autonomy,
      requestedBudgetMinorClp: body.requestedBudgetMinorClp,
      spentTodayMinorClp: body.spentTodayMinorClp,
      policyAllowed: body.policyAllowed,
      stableContextRefs: body.stableContextRefs,
      volatileContextRefs: body.volatileContextRefs,
      idempotencyKey: body.idempotencyKey,
      deadlineAt: body.deadlineAt,
    });
    return reply.code(201).send(result);
  });

  app.post("/v1/agent-os/:accountId/sessions/:sessionId/start", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = sessionParams.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.startSession(params.sessionId);
  });

  app.post("/v1/agent-os/:accountId/sessions/:sessionId/heartbeat", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = sessionParams.parse(request.params);
    const body = z
      .object({
        iterationCount: z.number().int().nonnegative(),
        spentMinorClp: z.number().int().nonnegative().safe(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.heartbeat({ sessionId: params.sessionId, ...body });
  });

  app.post("/v1/agent-os/:accountId/sessions/:sessionId/complete", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = sessionParams.parse(request.params);
    const body = z
      .object({
        outputRefs: z.array(z.string().min(1)).min(1).max(200),
        spentMinorClp: z.number().int().nonnegative().safe(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.agentOs.completeSession({ sessionId: params.sessionId, ...body });
  });

  app.post("/v1/agent-os/:accountId/sessions/:sessionId/fail", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = sessionParams.parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    return dependencies.runtime.agentOs.failSession({ sessionId: params.sessionId, ...body });
  });

  app.get("/v1/agent-os/:accountId/sessions", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      sessions: await dependencies.runtime.agentOs.listSessions(params.accountId, query.limit),
    };
  });

  app.get("/v1/agent-os/:accountId/preflights", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      preflights: await dependencies.runtime.agentOs.listPreflights(params.accountId, query.limit),
    };
  });

  app.get("/v1/agent-os/:accountId/scorecards", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParams.parse(request.params);
    const query = z
      .object({ periodStart: z.string().datetime(), periodEnd: z.string().datetime() })
      .refine((value) => value.periodStart <= value.periodEnd, {
        message: "periodStart must be before periodEnd.",
      })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    return {
      scorecards: await dependencies.runtime.agentOs.scorecards({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...query,
      }),
    };
  });
}

function preflightSchema() {
  return z.object({
    agentId: z.string().min(2),
    requestedAction: z.string().min(3),
    availableEvidenceKinds: z.array(z.string().min(1)).max(100),
    autonomy,
    requestedBudgetMinorClp: z.number().int().nonnegative().safe(),
    spentTodayMinorClp: z.number().int().nonnegative().safe(),
    policyAllowed: z.boolean(),
    stableContextRefs: z.array(z.string().min(1)).max(100),
    volatileContextRefs: z.array(z.string().min(1)).max(100),
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SPECIALIST_DAEMON_IDS } from "@eauto/domain";
import {
  accountParamsSchema,
  limitQuerySchema,
  type CompanyRouteDependencies,
} from "./companyRouteSupport.js";

export function registerCompanyBrainRoutes(
  app: FastifyInstance,
  dependencies: CompanyRouteDependencies,
): void {
  app.post("/v1/company/:accountId/brain/rebuild", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const body = z
      .object({ maximumAgeMs: z.number().int().min(60_000).max(86_400_000) })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "agents.run");
    return dependencies.runtime.accountBrain.rebuild({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      maximumAgeMs: body.maximumAgeMs,
    });
  });

  app.get("/v1/company/:accountId/brain", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const snapshot = await dependencies.runtime.accountBrain.latest({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return snapshot ?? reply.code(404).send({ error: "account-brain-not-found" });
  });

  app.post("/v1/company/:accountId/daemons/initialize", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.manage");
    await dependencies.runtime.daemons.initialize({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return reply.code(204).send();
  });

  app.get("/v1/company/:accountId/daemons", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
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
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema
      .extend({ daemonId: z.enum(SPECIALIST_DAEMON_IDS).optional() })
      .parse(request.query);
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
}

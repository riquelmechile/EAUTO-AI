import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRODUCT_LIFECYCLE_STATES, SUPPLY_WORKFLOW_KINDS } from "@eauto/domain";
import {
  accountParamsSchema,
  limitQuerySchema,
  listingParamsSchema,
  resourceParamsSchema,
  type CompanyRouteDependencies,
} from "./companyRouteSupport.js";

export function registerCompanyOperationsRoutes(
  app: FastifyInstance,
  dependencies: CompanyRouteDependencies,
): void {
  registerSupplyRoutes(app, dependencies);
  registerLifecycleRoutes(app, dependencies);
  registerEconomicRoutes(app, dependencies);
}

function registerSupplyRoutes(app: FastifyInstance, dependencies: CompanyRouteDependencies): void {
  app.post("/v1/company/:accountId/supply/workflows", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
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
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema.parse(request.query);
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
    const params = resourceParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "agents.read");
    const workflow = await dependencies.runtime.supply.get({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      id: params.id,
    });
    return workflow ?? reply.code(404).send({ error: "supply-workflow-not-found" });
  });
}

function registerLifecycleRoutes(
  app: FastifyInstance,
  dependencies: CompanyRouteDependencies,
): void {
  app.post("/v1/company/:accountId/lifecycle/:listingId/assess", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = listingParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return dependencies.runtime.lifecycle.assess({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      listingId: params.listingId,
    });
  });

  app.post("/v1/company/:accountId/lifecycle/assess", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const body = z
      .object({ limit: z.number().int().min(1).max(1_000).optional() })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
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
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema
      .extend({ state: z.enum(PRODUCT_LIFECYCLE_STATES).optional() })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
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
    const params = listingParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    const assessment = await dependencies.runtime.lifecycle.latest({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      listingId: params.listingId,
    });
    return assessment ?? reply.code(404).send({ error: "lifecycle-not-found" });
  });
}

function registerEconomicRoutes(
  app: FastifyInstance,
  dependencies: CompanyRouteDependencies,
): void {
  const economic = () => {
    if (!dependencies.runtime.economic) throw new Error("Economic operations require PostgreSQL.");
    return dependencies.runtime.economic;
  };

  app.get("/v1/company/:accountId/economic/status", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return economic().status({ organizationId: actor.organizationId, accountId: params.accountId });
  });

  app.get("/v1/company/:accountId/economic/coverage", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return {
      rows: await economic().coverage({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
      }),
    };
  });

  app.get("/v1/company/:accountId/economic/missing", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const query = limitQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return {
      rows: await economic().missing({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        limit: query.limit,
      }),
    };
  });

  app.get("/v1/company/:accountId/economic/evidence/:listingId", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = listingParamsSchema.parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    const evidence = await economic().inspectEvidence({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      listingId: params.listingId,
    });
    return evidence ?? reply.code(404).send({ error: "economic-evidence-not-found" });
  });

  app.post("/v1/company/:accountId/economic/ingest", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const body = z
      .object({
        listingId: z.string().min(3).max(256).optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "operations.manage");
    return economic().ingest({
      organizationId: actor.organizationId,
      accountId: params.accountId,
      ...(body.listingId ? { listingId: body.listingId } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
    });
  });

  app.post("/v1/company/:accountId/economic/reconcile", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = accountParamsSchema.parse(request.params);
    const body = z
      .object({
        listingId: z.string().min(3).max(256).optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "operations.manage");
    return {
      rows: await economic().reconcile({
        organizationId: actor.organizationId,
        accountId: params.accountId,
        ...(body.listingId ? { listingId: body.listingId } : {}),
        ...(body.limit ? { limit: body.limit } : {}),
      }),
    };
  });
}

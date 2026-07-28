import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission } from "@eauto/domain";
import type { Runtime } from "./runtime.js";

const accountQuerySchema = z.object({ accountId: z.string().min(3) });
const syncSchema = z.object({
  accountId: z.string().min(3),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type Dependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

export function registerMercadoLibreProductAdsRoutes(
  app: FastifyInstance,
  dependencies: Dependencies,
): void {
  app.post("/v1/integrations/mercadolibre/product-ads/sync", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const body = syncSchema.parse(request.body);
    await dependencies.requireAccount(actor, body.accountId, "integrations.sync");
    const service = requireProductAds(dependencies.runtime);
    const result = await service.sync({
      organizationId: actor.organizationId,
      accountId: body.accountId,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });
    return reply.code(202).send(result);
  });

  app.get("/v1/integrations/mercadolibre/product-ads/campaigns", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = accountQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "integrations.read");
    return {
      campaigns: await requireProductAds(dependencies.runtime).listCampaigns(query.accountId),
    };
  });

  app.get("/v1/integrations/mercadolibre/product-ads/ad-groups", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = accountQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "integrations.read");
    return {
      adGroups: await requireProductAds(dependencies.runtime).listAdGroups(query.accountId),
    };
  });

  app.get("/v1/integrations/mercadolibre/product-ads/items", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = accountQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "integrations.read");
    return { items: await requireProductAds(dependencies.runtime).listItems(query.accountId) };
  });

  app.get("/v1/integrations/mercadolibre/product-ads/reconciliations", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = accountQuerySchema.parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "integrations.read");
    return {
      reconciliations: await requireProductAds(dependencies.runtime).listReconciliations(
        query.accountId,
      ),
    };
  });
}

function requireProductAds(runtime: Runtime) {
  if (!runtime.mercadoLibreProductAds) {
    const error = new Error("MercadoLibre Product Ads is disabled.");
    error.name = "MercadoLibreProductAdsDisabledError";
    throw error;
  }
  return runtime.mercadoLibreProductAds;
}

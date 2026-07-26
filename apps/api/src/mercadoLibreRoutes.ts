import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MercadoLibreIntegrationError, type ActorIdentity, type Permission } from "@eauto/domain";
import type { MercadoLibreService } from "@eauto/application";
import type { Runtime } from "./runtime.js";

export const MERCADOLIBRE_MOBILE_RETURN_URI = "eautoai://mercadolibre/oauth-complete";

export type MercadoLibreRouteDependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

export function registerMercadoLibreRoutes(
  app: FastifyInstance,
  dependencies: MercadoLibreRouteDependencies,
): void {
  app.post("/v1/integrations/mercadolibre/:accountId/authorize", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.manage");
    return requireService(dependencies.runtime).beginAuthorization({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
  });

  app.get("/v1/integrations/mercadolibre/oauth/callback", async (request, reply) => {
    const query = z
      .object({ state: z.string().min(20), code: z.string().min(1) })
      .parse(request.query);
    const connection = await requireService(dependencies.runtime).completeAuthorization(query);
    return reply.redirect(createMercadoLibreMobileReturnUrl(connection));
  });

  app.get("/v1/integrations/mercadolibre/:accountId/status", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.read");
    const connection = await requireService(dependencies.runtime).getConnection({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return { enabled: true, connected: connection !== null, connection };
  });

  app.post("/v1/integrations/mercadolibre/:accountId/sync", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.sync");
    const result = await requireService(dependencies.runtime).syncReadModel({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return {
      connection: result.connection,
      listingCount: result.listings.length,
      observedAt: result.connection.lastSyncedAt,
      writesPerformed: false,
    };
  });

  app.get("/v1/integrations/mercadolibre/:accountId/listings", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.read");
    return {
      listings: await requireService(dependencies.runtime).listListingSnapshots({
        organizationId: actor.organizationId,
        accountId: params.accountId,
      }),
    };
  });

  app.post("/v1/integrations/mercadolibre/:accountId/customer-operations/sync", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.sync");
    const result = await requireService(dependencies.runtime).syncCustomerOperations({
      organizationId: actor.organizationId,
      accountId: params.accountId,
    });
    return {
      claimCount: result.claims.length,
      openClaimCount: result.claims.filter((claim) => claim.status === "opened").length,
      questionCount: result.questions.length,
      unansweredQuestionCount: result.questions.filter((question) => !question.hasAnswer).length,
      observedAt: result.observedAt,
      writesPerformed: false,
    };
  });

  app.get("/v1/integrations/mercadolibre/:accountId/claims", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.read");
    return {
      claims: await requireService(dependencies.runtime).listClaimSnapshots({
        organizationId: actor.organizationId,
        accountId: params.accountId,
      }),
    };
  });

  app.get("/v1/integrations/mercadolibre/:accountId/questions", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "integrations.read");
    return {
      questions: await requireService(dependencies.runtime).listQuestionSnapshots({
        organizationId: actor.organizationId,
        accountId: params.accountId,
      }),
    };
  });
}

export function createMercadoLibreMobileReturnUrl(connection: {
  accountId: string;
  siteId: string;
  status: string;
}): string {
  const returnUrl = new URL(MERCADOLIBRE_MOBILE_RETURN_URI);
  returnUrl.searchParams.set("result", "connected");
  returnUrl.searchParams.set("accountId", connection.accountId);
  returnUrl.searchParams.set("siteId", connection.siteId);
  returnUrl.searchParams.set("status", connection.status);
  return returnUrl.toString();
}

function requireService(runtime: Runtime): MercadoLibreService {
  if (!runtime.mercadoLibre) {
    throw new MercadoLibreIntegrationError(
      "mercadolibre-disabled",
      "MercadoLibre Chile integration is disabled.",
    );
  }
  return runtime.mercadoLibre;
}

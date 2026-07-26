import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  MercadoLibreIntegrationError,
  MercadoLibreOAuthStateError,
  MercadoLibreRefreshBusyError,
  assertAuthorized,
  canAccessAccount,
  type ActorIdentity,
  type CommerceAccount,
  type Permission,
} from "@eauto/domain";
import { createAuthenticator, readBearerToken, type EnrollmentAuthenticator } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { MercadoLibreRuntime } from "./mercadoLibreRuntime.js";
import type { Runtime } from "./runtime.js";

const accountParamsSchema = z.object({ accountId: z.string().min(3).max(128) });
const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4_096),
  state: z.string().min(16).max(4_096),
});

export async function registerMercadoLibreRoutes(
  app: FastifyInstance,
  config: AppConfig,
  core: Runtime,
  integration: MercadoLibreRuntime,
): Promise<void> {
  const authenticator = createAuthenticator({
    mode: config.AUTH_MODE,
    identitiesJson: config.OPERATOR_TOKENS_JSON,
    nodeEnv: config.NODE_ENV,
  });

  app.get("/v1/integrations/mercadolibre/ready", async (request) => {
    await authorize(request, core, authenticator, "integrations.read");
    return {
      enabled: integration.enabled,
      site: "MLC",
      country: "CL",
      mode: "read-only",
      externalWrites: false,
    };
  });

  app.post("/v1/integrations/mercadolibre/:accountId/authorize", async (request, reply) => {
    try {
      const actor = await authenticate(request, core, authenticator);
      const { accountId } = accountParamsSchema.parse(request.params);
      await requireAccount(core, actor, accountId, "integrations.manage");
      const service = requireService(integration);
      const authorization = await service.startAuthorization({ actor, accountId });
      return reply.code(201).send({
        ...authorization,
        accountId,
        site: "MLC",
        country: "CL",
        pkce: "S256",
      });
    } catch (error) {
      return sendMercadoLibreError(reply, error);
    }
  });

  app.get("/v1/integrations/mercadolibre/callback", async (request, reply) => {
    try {
      const query = callbackQuerySchema.parse(request.query);
      const service = requireService(integration);
      const connection = await service.completeAuthorization(query);
      return reply.send({
        connected: true,
        connection,
        externalWritesEnabled: false,
      });
    } catch (error) {
      return sendMercadoLibreError(reply, error);
    }
  });

  app.get("/v1/integrations/mercadolibre/:accountId", async (request, reply) => {
    try {
      const actor = await authenticate(request, core, authenticator);
      const { accountId } = accountParamsSchema.parse(request.params);
      await requireAccount(core, actor, accountId, "integrations.read");
      const service = requireService(integration);
      const connection = await service.getStatus({
        organizationId: actor.organizationId,
        accountId,
      });
      if (!connection) return reply.code(404).send({ error: "not-connected" });
      const snapshot = await service.getSnapshot({
        organizationId: actor.organizationId,
        accountId,
      });
      return reply.send({ connection, snapshot, externalWritesEnabled: false });
    } catch (error) {
      return sendMercadoLibreError(reply, error);
    }
  });

  app.post("/v1/integrations/mercadolibre/:accountId/sync", async (request, reply) => {
    try {
      const actor = await authenticate(request, core, authenticator);
      const { accountId } = accountParamsSchema.parse(request.params);
      await requireAccount(core, actor, accountId, "integrations.sync");
      const service = requireService(integration);
      const snapshot = await service.syncReadOnly({
        organizationId: actor.organizationId,
        accountId,
        workerId: `api-${actor.id}`,
      });
      return reply.send({ snapshot, externalWritesPerformed: false });
    } catch (error) {
      return sendMercadoLibreError(reply, error);
    }
  });
}

function requireService(integration: MercadoLibreRuntime) {
  if (!integration.enabled || !integration.service) {
    throw new MercadoLibreIntegrationError("Mercado Libre integration is disabled.");
  }
  return integration.service;
}

async function authenticate(
  request: FastifyRequest,
  runtime: Runtime,
  authenticator: EnrollmentAuthenticator,
): Promise<ActorIdentity> {
  if (authenticator.developmentActor) return authenticator.developmentActor;
  const accessToken = readBearerToken(request.headers.authorization);
  return runtime.sessionService.authenticateAccess(accessToken);
}

async function authorize(
  request: FastifyRequest,
  runtime: Runtime,
  authenticator: EnrollmentAuthenticator,
  permission: Permission,
): Promise<ActorIdentity> {
  const actor = await authenticate(request, runtime, authenticator);
  assertAuthorized(actor, permission);
  return actor;
}

async function requireAccount(
  runtime: Runtime,
  actor: ActorIdentity,
  accountId: string,
  permission: Permission,
): Promise<CommerceAccount> {
  const account = await runtime.accounts.get(accountId);
  if (
    !account ||
    account.organizationId !== actor.organizationId ||
    !canAccessAccount(actor, account.id)
  ) {
    throw new MercadoLibreIntegrationError("Account not found.");
  }
  assertAuthorized(actor, permission, account.id);
  return account;
}

function sendMercadoLibreError(reply: FastifyReply, error: unknown) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "validation-error", issues: error.issues });
  }
  if (error instanceof MercadoLibreOAuthStateError) {
    return reply.code(400).send({ error: error.code, message: error.message });
  }
  if (error instanceof MercadoLibreRefreshBusyError) {
    return reply.code(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof MercadoLibreIntegrationError) {
    const status = /disabled/i.test(error.message) ? 503 : 409;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

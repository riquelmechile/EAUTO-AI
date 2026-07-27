import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  ACTION_KINDS,
  AuthenticationError,
  AuthorizationError,
  MercadoLibreIntegrationError,
  MercadoLibreWriteBlockedError,
  SOURCE_IMAGE_CONTENT_TYPES,
  SessionExpiredError,
  SessionRevokedError,
  UploadValidationError,
  assertAuthorized,
  assertUsableEvidencePack,
  canAccessAccount,
  type ActorIdentity,
  type BusinessAction,
  type CommerceAccount,
  type Permission,
  type ProductLaunchBrief,
} from "@eauto/domain";
import { createAuthenticator, readBearerToken, type EnrollmentAuthenticator } from "./auth.js";
import { registerMercadoLibreRoutes } from "./mercadoLibreRoutes.js";
import { registerAgentOsRoutes } from "./agentOsRoutes.js";
import { createOperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";
import { createRuntime, type Runtime } from "./runtime.js";
import type { AppConfig } from "./config.js";

const sourceImageUploadSchema = z.object({
  id: z.string().min(3).max(128),
  accountId: z.string().min(3),
  originalFileName: z.string().min(1).max(255),
  contentType: z.enum(SOURCE_IMAGE_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
  checksumSha256Base64: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});

const launchSchema = z.object({
  id: z.string().min(3),
  accountId: z.string().min(3),
  sourceImageUploadId: z.string().min(3),
  knownCostMinor: z.number().int().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
  instructions: z.string().max(2000).optional(),
  requestedChannels: z
    .array(z.enum(["mercadolibre", "instagram", "facebook", "tiktok", "owned"]))
    .min(1),
});

const actionSchema = z.object({
  accountId: z.string().min(3),
  kind: z.enum(ACTION_KINDS),
  target: z.string().min(1),
  exactChanges: z
    .array(z.object({ field: z.string().min(1), from: z.unknown(), to: z.unknown() }))
    .min(1)
    .max(100),
  rationale: z.string().min(3).max(5_000),
  risk: z.enum(["low", "medium", "high", "critical"]),
  evidencePackId: z.string().min(3),
});

class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found.`);
    this.name = "NotFoundError";
  }
}

export async function buildApp(config: AppConfig, suppliedRuntime?: Runtime) {
  const runtime = suppliedRuntime ?? createRuntime(config);
  const intelligenceRuntime = createOperationalIntelligenceRuntime(runtime, config);
  const authenticator = createAuthenticator({
    mode: config.AUTH_MODE,
    identitiesJson: config.OPERATOR_TOKENS_JSON,
    nodeEnv: config.NODE_ENV,
  });
  const app = Fastify({ logger: config.NODE_ENV !== "test" });
  const corsOrigins = config.CORS_ORIGIN.split(",").map((origin) => origin.trim());
  const corsOrigin =
    corsOrigins.length === 1 ? (corsOrigins[0] === "*" ? true : corsOrigins[0]) : corsOrigins;
  await app.register(cors, corsOrigin === undefined ? {} : { origin: corsOrigin });

  app.get("/health", () => ({ ok: true, service: "eauto-api" }));
  app.get("/ready", async () => {
    await runtime.outbox.stats([]);
    return { ok: true };
  });

  app.post("/v1/auth/session", async (request, reply) => {
    const actor = authenticator.authenticateEnrollment(request.headers.authorization);
    const session = await runtime.sessionService.issue(actor);
    return reply.code(201).send(session);
  });

  app.post("/v1/auth/refresh", async (request) => {
    const refreshToken = readBearerToken(request.headers.authorization);
    return runtime.sessionService.rotate(refreshToken);
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const accessToken = readBearerToken(request.headers.authorization);
    await runtime.sessionService.revokeAccess(accessToken);
    return reply.code(204).send();
  });

  registerMercadoLibreRoutes(app, {
    runtime,
    webhookToken: config.MELI_WEBHOOK_TOKEN ?? null,
    authenticate: (request) => authenticate(request, runtime, authenticator),
    requireAccount: async (actor, accountId, permission) => {
      await requireAccount(runtime, actor, accountId, permission);
    },
  });

  registerAgentOsRoutes(app, {
    runtime,
    intelligenceRuntime,
    manualControlEnabled: config.AGENT_MANUAL_CONTROL_ENABLED,
    authenticate: (request) => authenticate(request, runtime, authenticator),
    requireAccount: async (actor, accountId, permission) => {
      await requireAccount(runtime, actor, accountId, permission);
    },
  });

  app.get("/v1/me", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "dashboard.read");
    return { actor };
  });

  app.get("/v1/dashboard", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "dashboard.read");
    const accounts = await authorizedAccounts(runtime, actor);
    const pending = (
      await Promise.all(accounts.map((account) => runtime.actions.listPending(account.id)))
    ).flat();
    return {
      company: "EAUTO-AI",
      doctrine: "https://the-amazing-gentleman-programming-book.vercel.app/es",
      actor: { id: actor.id, roles: actor.roles },
      accounts,
      pendingDecisions: pending.length,
      status: "secured-foundation",
    };
  });

  app.get("/v1/inbox", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "inbox.read");
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    if (query.accountId) {
      await requireAccount(runtime, actor, query.accountId, "inbox.read");
      return { actions: await runtime.actions.listPending(query.accountId) };
    }
    const accounts = await authorizedAccounts(runtime, actor);
    const actions = (
      await Promise.all(accounts.map((account) => runtime.actions.listPending(account.id)))
    ).flat();
    return { actions };
  });

  app.post("/v1/uploads/source-images", async (request, reply) => {
    const actor = await authenticate(request, runtime, authenticator);
    const body = sourceImageUploadSchema.parse(request.body);
    await requireAccount(runtime, actor, body.accountId, "content.create");
    const requested = await runtime.sourceImageUploads.requestUpload({
      ...body,
      organizationId: actor.organizationId,
    });
    return reply.code(201).send(requested);
  });

  app.post("/v1/uploads/source-images/:id/complete", async (request) => {
    const actor = await authenticate(request, runtime, authenticator);
    const params = z.object({ id: z.string().min(3) }).parse(request.params);
    const body = z.object({ accountId: z.string().min(3) }).parse(request.body);
    await requireAccount(runtime, actor, body.accountId, "content.create");
    return runtime.sourceImageUploads.verifyUpload(params.id, actor.organizationId, body.accountId);
  });

  app.post("/v1/content/launches", async (request, reply) => {
    const actor = await authenticate(request, runtime, authenticator);
    const body = launchSchema.parse(request.body);
    await requireAccount(runtime, actor, body.accountId, "content.create");
    const sourceImage = await runtime.sourceImageUploads.requireVerified(
      body.sourceImageUploadId,
      actor.organizationId,
      body.accountId,
    );
    const brief: ProductLaunchBrief = Object.freeze({
      id: body.id,
      accountId: body.accountId,
      sourceImageUri: sourceImage.objectUri,
      ...(body.knownCostMinor === undefined ? {} : { knownCostMinor: body.knownCostMinor }),
      ...(body.stock === undefined ? {} : { stock: body.stock }),
      ...(body.instructions === undefined ? {} : { instructions: body.instructions }),
      requestedChannels: body.requestedChannels,
    });
    const assets = await runtime.contentStudio.createLaunch(brief);
    return reply.code(201).send({
      brief,
      sourceImageUpload: sourceImage,
      assets,
      requestedBy: actor.id,
      externalGenerationPerformed: runtime.contentGenerationMode === "external",
    });
  });

  app.post("/v1/actions", async (request, reply) => {
    const actor = await authenticate(request, runtime, authenticator);
    const body = actionSchema.parse(request.body);
    await requireAccount(runtime, actor, body.accountId, "action.propose");
    const evidencePack = await intelligenceRuntime.repository.getEvidencePack({
      id: body.evidencePackId,
      organizationId: actor.organizationId,
      accountId: body.accountId,
    });
    if (!evidencePack) throw new NotFoundError("Evidence pack");
    const now = new Date();
    assertUsableEvidencePack(evidencePack, now.toISOString());
    const action: BusinessAction = Object.freeze({
      id: `action_${randomUUID()}`,
      accountId: body.accountId,
      kind: body.kind,
      target: body.target,
      exactChanges: body.exactChanges,
      rationale: body.rationale,
      risk: body.risk,
      status: "draft",
      evidenceBundle: Object.freeze({
        id: evidencePack.id,
        accountId: evidencePack.accountId,
        references: Object.freeze(evidencePack.documents.map((document) => document.reference)),
        complete: evidencePack.complete,
        missingInputs: evidencePack.missingInputs,
      }),
      policyVersion: config.ACTION_POLICY_VERSION,
      expiresAt: new Date(now.getTime() + config.ACTION_APPROVAL_TTL_MS).toISOString(),
    });
    const proposed = await runtime.actionService.propose(action, actor.id);
    return reply.code(201).send(proposed);
  });

  app.post("/v1/actions/:id/review", async (request) => {
    const actor = await authenticate(request, runtime, authenticator);
    const params = z.object({ id: z.string() }).parse(request.params);
    await requireAction(runtime, actor, params.id, "action.review");
    return runtime.actionService.markReviewed(params.id, actor.id);
  });

  app.post("/v1/actions/:id/approve", async (request) => {
    const actor = await authenticate(request, runtime, authenticator);
    const params = z.object({ id: z.string() }).parse(request.params);
    await requireAction(runtime, actor, params.id, "action.approve");
    return runtime.actionService.approve(params.id, actor.id);
  });

  app.post("/v1/actions/:id/execute", async (request) => {
    const actor = await authenticate(request, runtime, authenticator);
    const params = z.object({ id: z.string() }).parse(request.params);
    await requireAction(runtime, actor, params.id, "action.execute");
    return runtime.actionService.execute(params.id, actor.id);
  });

  app.get("/v1/actions/:id/receipts", async (request) => {
    const actor = await authenticate(request, runtime, authenticator);
    const params = z.object({ id: z.string() }).parse(request.params);
    await requireAction(runtime, actor, params.id, "receipts.read");
    return { receipts: await runtime.receipts.listForAction(params.id) };
  });

  app.get("/v1/operations/readiness", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "operations.read");
    const accounts = await authorizedAccounts(runtime, actor);
    const accountIds = accounts.map((account) => account.id);
    return {
      ok: true,
      mode: config.NODE_ENV,
      authentication: authenticator.mode === "disabled" ? "development-owner" : "rotating-session",
      persistence: runtime.persistenceMode,
      outbox: await runtime.outbox.stats(accountIds),
      mercadoLibreChile: { enabled: runtime.mercadoLibre !== null, siteId: "MLC" },
      actionExecution: runtime.actionExecutionMode,
      contentGeneration: runtime.contentGenerationMode,
      agentOs: { enabled: true, delegationDepth: 2 },
    };
  });

  app.get("/v1/operations/outbox", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "operations.read");
    const accounts = await authorizedAccounts(runtime, actor);
    return { stats: await runtime.outbox.stats(accounts.map((account) => account.id)) };
  });

  app.get("/v1/operations/outbox/dead", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "operations.read");
    const accounts = await authorizedAccounts(runtime, actor);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(request.query);
    return {
      events: await runtime.outbox.listDead({
        accountIds: accounts.map((account) => account.id),
        limit: query.limit,
      }),
    };
  });

  app.post("/v1/operations/outbox/dead/:id/requeue", async (request) => {
    const actor = await authorize(request, runtime, authenticator, "operations.manage");
    const accounts = await authorizedAccounts(runtime, actor);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      await runtime.outbox.requeueDead({
        id: params.id,
        accountIds: accounts.map((account) => account.id),
        availableAt: new Date().toISOString(),
      });
    } catch {
      throw new NotFoundError("Dead-letter event");
    }
    return { requeued: true, eventId: params.id, requeuedBy: actor.id };
  });

  app.addHook("onClose", async () => {
    await intelligenceRuntime.close();
    await runtime.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: "validation-error", issues: error.issues });
      return;
    }
    if (error instanceof UploadValidationError) {
      void reply.code(400).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof MercadoLibreIntegrationError) {
      const status = error.code === "mercadolibre-invalid-state" ? 400 : 409;
      void reply.code(status).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof MercadoLibreWriteBlockedError) {
      void reply.code(409).send({ error: error.code, message: error.message });
      return;
    }
    if (
      error instanceof AuthenticationError ||
      error instanceof SessionExpiredError ||
      error instanceof SessionRevokedError
    ) {
      void reply.code(401).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof AuthorizationError) {
      void reply.code(403).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof NotFoundError) {
      void reply.code(404).send({ error: "not-found", message: error.message });
      return;
    }
    if (
      error instanceof Error &&
      /(must|required|expired|matches|verification failed)/i.test(error.message)
    ) {
      request.log.warn({ err: error, requestId: request.id }, "Request conflict");
      void reply.code(409).send({
        error: "action-conflict",
        message: "The requested operation conflicts with the current state.",
        requestId: request.id,
      });
      return;
    }
    request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    void reply.code(500).send({
      error: "internal-error",
      message: "Unexpected server error.",
      requestId: request.id,
    });
  });

  return app;
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

async function authorizedAccounts(
  runtime: Runtime,
  actor: ActorIdentity,
): Promise<readonly CommerceAccount[]> {
  const accounts = await runtime.accounts.list();
  return accounts.filter(
    (account) =>
      account.organizationId === actor.organizationId && canAccessAccount(actor, account.id),
  );
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
    throw new NotFoundError("Account");
  }
  assertAuthorized(actor, permission, account.id);
  return account;
}

async function requireAction(
  runtime: Runtime,
  actor: ActorIdentity,
  actionId: string,
  permission: Permission,
): Promise<BusinessAction> {
  const action = await runtime.actions.get(actionId);
  if (!action) throw new NotFoundError("Action");
  await requireAccount(runtime, actor, action.accountId, permission);
  return action;
}

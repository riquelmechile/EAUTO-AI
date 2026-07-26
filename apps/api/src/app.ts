import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { BusinessAction, ProductLaunchBrief } from "@eauto/domain";
import { createRuntime, type Runtime } from "./runtime.js";
import type { AppConfig } from "./config.js";

const launchSchema = z.object({
  id: z.string().min(3),
  accountId: z.string().min(3),
  sourceImageUri: z.string().min(1),
  knownCostMinor: z.number().int().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
  instructions: z.string().max(2000).optional(),
  requestedChannels: z
    .array(z.enum(["mercadolibre", "instagram", "facebook", "tiktok", "owned"]))
    .min(1),
});

const actionSchema = z.object({
  id: z.string().min(3),
  accountId: z.string().min(3),
  kind: z.string().min(3),
  target: z.string().min(1),
  exactChanges: z.array(z.object({ field: z.string(), from: z.unknown(), to: z.unknown() })).min(1),
  rationale: z.string().min(3),
  risk: z.enum(["low", "medium", "high", "critical"]),
  evidenceBundle: z.object({
    id: z.string().min(3),
    accountId: z.string().min(3),
    references: z
      .array(
        z.object({
          id: z.string(),
          source: z.string(),
          sourceRecordId: z.string(),
          observedAt: z.string(),
          freshness: z.enum(["fresh", "stale", "unknown"]),
          confidence: z.enum(["low", "medium", "high"]),
          contentHash: z.string(),
        }),
      )
      .min(1),
    complete: z.literal(true),
    missingInputs: z.array(z.string()).max(0),
  }),
  policyVersion: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export async function buildApp(config: AppConfig, suppliedRuntime?: Runtime) {
  const runtime = suppliedRuntime ?? createRuntime(config);
  const app = Fastify({ logger: config.NODE_ENV !== "test" });
  await app.register(cors, { origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN });

  app.get("/health", () => ({ ok: true, service: "eauto-api" }));
  app.get("/ready", () => ({
    ok: true,
    mode: config.NODE_ENV,
    persistence: runtime.persistenceMode,
    externalWrites: false,
    contentGeneration: "development-simulator",
  }));

  app.get("/v1/dashboard", async () => {
    const accounts = await runtime.accounts.list();
    const pending = await runtime.actions.listPending();
    return {
      company: "EAUTO-AI",
      doctrine: "https://the-amazing-gentleman-programming-book.vercel.app/es",
      accounts,
      pendingDecisions: pending.length,
      status: "foundation",
    };
  });

  app.get("/v1/inbox", async (request) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    return { actions: await runtime.actions.listPending(query.accountId) };
  });

  app.post("/v1/content/launches", async (request, reply) => {
    const brief = launchSchema.parse(request.body) as ProductLaunchBrief;
    const account = await runtime.accounts.get(brief.accountId);
    if (!account) return reply.code(404).send({ error: "account-not-found" });
    const assets = await runtime.contentStudio.createLaunch(brief);
    return reply.code(201).send({ brief, assets, externalGenerationPerformed: false });
  });

  app.post("/v1/actions", async (request, reply) => {
    const body = actionSchema.parse(request.body);
    const action: BusinessAction = Object.freeze({ ...body, status: "draft" });
    const proposed = await runtime.actionService.propose(action);
    return reply.code(201).send(proposed);
  });

  app.post("/v1/actions/:id/review", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return runtime.actionService.markReviewed(params.id);
  });

  app.post("/v1/actions/:id/approve", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ approvedBy: z.string().min(1) }).parse(request.body);
    return runtime.actionService.approve(params.id, body.approvedBy);
  });

  app.post("/v1/actions/:id/execute", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return runtime.actionService.execute(params.id);
  });

  app.get("/v1/actions/:id/receipts", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { receipts: await runtime.receipts.listForAction(params.id) };
  });

  app.addHook("onClose", async () => runtime.close());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: "validation-error", issues: error.issues });
      return;
    }
    void reply.code(500).send({
      error: "internal-error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });

  return app;
}

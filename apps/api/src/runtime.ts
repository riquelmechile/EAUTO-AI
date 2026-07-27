import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  accountId,
  organizationId,
  type BusinessAction,
  type CommerceAccount,
} from "@eauto/domain";
import {
  ActionService,
  AgentOsService,
  ContentStudioService,
  MercadoLibreNotificationIngestionService,
  MercadoLibreNotificationProcessor,
  MercadoLibreService,
  OutboxProcessor,
  SessionService,
  ShadowLlmService,
  SourceImageUploadService,
  type ActionExecutor,
  type ContentGenerationPort,
  type OutboxEventHandler,
} from "@eauto/application";
import {
  DeterministicContentProvider,
  DisabledContentProvider,
  HttpContentProvider,
} from "@eauto/content";
import {
  DeepSeekGateway,
  DisabledActionExecutor,
  HttpActionExecutor,
  InMemoryAccountRepository,
  InMemoryActionRepository,
  InMemoryAgentOsRepository,
  InMemoryContentAssetRepository,
  InMemoryLlmRunRepository,
  InMemoryMercadoLibreConnectionRepository,
  InMemoryMercadoLibreOAuthStateRepository,
  InMemoryMercadoLibreNotificationRepository,
  InMemoryOutboxRepository,
  InMemoryReceiptRepository,
  InMemorySessionRepository,
  InMemorySourceImageUploadRepository,
  MercadoLibreHttpClient,
  NodeMercadoLibreSecurity,
  PostgresAccountRepository,
  PostgresActionRepository,
  PostgresAgentOsRepository,
  PostgresContentAssetRepository,
  PostgresLlmRunRepository,
  PostgresMercadoLibreConnectionRepository,
  PostgresMercadoLibreOAuthStateRepository,
  PostgresMercadoLibreNotificationRepository,
  PostgresOutboxRepository,
  PostgresReceiptRepository,
  PostgresSessionRepository,
  PostgresSourceImageUploadRepository,
  S3ObjectStorage,
  type HttpActionRoutes,
} from "@eauto/infrastructure";
import { NodeSessionSecrets } from "./sessionSecrets.js";
import type { AppConfig } from "./config.js";

const developmentAccounts: readonly CommerceAccount[] = [
  Object.freeze({
    id: accountId("plasticov"),
    organizationId: organizationId("maustian"),
    name: "Plasticov",
    channel: "mercadolibre",
    market: "MLC",
    minimumMarginBps: 3500,
    autonomyLevel: "ask",
  }),
  Object.freeze({
    id: accountId("maustian"),
    organizationId: organizationId("maustian"),
    name: "Maustian",
    channel: "mercadolibre",
    market: "MLC",
    minimumMarginBps: 3500,
    autonomyLevel: "ask",
  }),
];

class VerifiedDevelopmentExecutor implements ActionExecutor {
  private readonly executed = new Set<string>();

  execute(action: BusinessAction): Promise<{ providerReceipt: unknown }> {
    this.executed.add(action.id);
    return Promise.resolve({
      providerReceipt: {
        provider: "development-simulator",
        externalMutation: false,
        actionId: action.id,
        warning: "No remote marketplace mutation was performed.",
      },
    });
  }

  verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }> {
    return Promise.resolve({
      verified: this.executed.has(action.id),
      observedState: { actionId: action.id, simulatorState: "recorded" },
    });
  }
}

const lifecycleHandler: OutboxEventHandler = () => Promise.resolve();
const lifecycleHandlers: Readonly<Record<string, OutboxEventHandler>> = Object.freeze({
  "action.proposed": lifecycleHandler,
  "action.reviewed": lifecycleHandler,
  "action.approved": lifecycleHandler,
  "action.execution.started": lifecycleHandler,
  "action.executed": lifecycleHandler,
  "action.verified": lifecycleHandler,
  "action.failed": lifecycleHandler,
});

export function createRuntime(config: AppConfig) {
  const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
  const outbox = pool ? new PostgresOutboxRepository(pool) : new InMemoryOutboxRepository();
  const accountRepository = pool
    ? new PostgresAccountRepository(pool)
    : new InMemoryAccountRepository(developmentAccounts);
  const actionRepository = pool
    ? new PostgresActionRepository(pool)
    : new InMemoryActionRepository(outbox);
  const receiptRepository = pool
    ? new PostgresReceiptRepository(pool)
    : new InMemoryReceiptRepository();
  const assetRepository = pool
    ? new PostgresContentAssetRepository(pool)
    : new InMemoryContentAssetRepository();
  const sessionRepository = pool
    ? new PostgresSessionRepository(pool)
    : new InMemorySessionRepository();
  const uploadRepository = pool
    ? new PostgresSourceImageUploadRepository(pool)
    : new InMemorySourceImageUploadRepository();
  const agentOsRepository = pool
    ? new PostgresAgentOsRepository(pool)
    : new InMemoryAgentOsRepository();
  const llmRuns = pool ? new PostgresLlmRunRepository(pool) : new InMemoryLlmRunRepository();
  const clock = { now: () => new Date() };
  const ids = { next: (prefix: string) => `${prefix}_${randomUUID()}` };
  const objectStorage = new S3ObjectStorage({
    bucket: config.OBJECT_STORAGE_BUCKET,
    region: config.OBJECT_STORAGE_REGION,
    ...(config.OBJECT_STORAGE_PUBLIC_ENDPOINT
      ? { publicEndpoint: config.OBJECT_STORAGE_PUBLIC_ENDPOINT }
      : {}),
    ...(config.OBJECT_STORAGE_INTERNAL_ENDPOINT
      ? { internalEndpoint: config.OBJECT_STORAGE_INTERNAL_ENDPOINT }
      : {}),
    ...(config.OBJECT_STORAGE_ACCESS_KEY ? { accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY } : {}),
    ...(config.OBJECT_STORAGE_SECRET_KEY
      ? { secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY }
      : {}),
    forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
  });
  const actionRuntime = createActionExecutorRuntime(config);
  const actionService = new ActionService(
    actionRepository,
    receiptRepository,
    actionRuntime.executor,
    clock,
    ids,
  );
  const agentOs = new AgentOsService(agentOsRepository, clock, ids);
  const shadowLlm = createShadowLlmRuntime(config, llmRuns, clock, ids);
  const contentRuntime = createContentGenerationRuntime(config, objectStorage);
  const contentStudio = new ContentStudioService(contentRuntime.provider, assetRepository);
  const sessionService = new SessionService(
    sessionRepository,
    new NodeSessionSecrets(),
    clock,
    ids,
    {
      accessMs: config.SESSION_ACCESS_TTL_MS,
      refreshMs: config.SESSION_REFRESH_TTL_MS,
    },
  );
  const sourceImageUploads = new SourceImageUploadService(uploadRepository, objectStorage, clock, {
    maximumBytes: config.SOURCE_IMAGE_MAX_BYTES,
    uploadExpiresInSeconds: config.SOURCE_IMAGE_UPLOAD_TTL_SECONDS,
  });
  const outboxProcessor = new OutboxProcessor(outbox, lifecycleHandlers, {
    workerId: `${config.OUTBOX_WORKER_ID}-${process.pid}`,
    leaseMs: config.OUTBOX_LEASE_MS,
    maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
    baseRetryMs: config.OUTBOX_BASE_RETRY_MS,
    maxRetryMs: config.OUTBOX_MAX_RETRY_MS,
    now: () => new Date(),
  });
  const mercadoLibre = createMercadoLibreRuntime(config, pool, clock);
  const mercadoLibreNotifications = pool
    ? new PostgresMercadoLibreNotificationRepository(pool)
    : new InMemoryMercadoLibreNotificationRepository();
  const mercadoLibreNotificationIngestion =
    config.MELI_WEBHOOK_ENABLED &&
    config.MELI_APPLICATION_ID &&
    config.MELI_PLASTICOV_SELLER_ID &&
    config.MELI_MAUSTIAN_SELLER_ID
      ? new MercadoLibreNotificationIngestionService(mercadoLibreNotifications, {
          applicationId: config.MELI_APPLICATION_ID,
          organizationId: "maustian",
          accountBySellerId: Object.freeze({
            [config.MELI_PLASTICOV_SELLER_ID]: "plasticov",
            [config.MELI_MAUSTIAN_SELLER_ID]: "maustian",
          }),
          now: () => new Date(),
          nextId: () => `meln_${randomUUID()}`,
        })
      : null;
  const mercadoLibreNotificationProcessor =
    config.MELI_WEBHOOK_ENABLED && mercadoLibre
      ? new MercadoLibreNotificationProcessor(mercadoLibreNotifications, mercadoLibre, {
          workerId: `${config.MELI_NOTIFICATION_WORKER_ID}-${process.pid}`,
          leaseMs: config.MELI_NOTIFICATION_LEASE_MS,
          maxAttempts: config.MELI_NOTIFICATION_MAX_ATTEMPTS,
          baseRetryMs: config.MELI_NOTIFICATION_BASE_RETRY_MS,
          maxRetryMs: config.MELI_NOTIFICATION_MAX_RETRY_MS,
          batchSize: config.MELI_NOTIFICATION_BATCH_SIZE,
          now: () => new Date(),
        })
      : null;

  return {
    accounts: accountRepository,
    actions: actionRepository,
    receipts: receiptRepository,
    assets: assetRepository,
    outbox,
    llmRuns,
    actionService,
    actionExecutionMode: actionRuntime.mode,
    agentOs,
    shadowLlm,
    contentStudio,
    contentGenerationMode: contentRuntime.mode,
    sessionService,
    sourceImageUploads,
    outboxProcessor,
    mercadoLibre,
    mercadoLibreNotifications,
    mercadoLibreNotificationIngestion,
    mercadoLibreNotificationProcessor,
    persistenceMode: pool ? ("postgres" as const) : ("in-memory-development" as const),
    close: () => pool?.end() ?? Promise.resolve(),
  };
}

function createActionExecutorRuntime(config: AppConfig): Readonly<{
  executor: ActionExecutor;
  mode: "external" | "disabled" | "development-simulator";
}> {
  if (config.ACTION_EXECUTION_ENABLED) {
    if (!config.ACTION_PROVIDER_API_KEY) {
      throw new Error("Action execution is enabled but provider API key is missing.");
    }
    return Object.freeze({
      executor: new HttpActionExecutor(parseActionRoutes(config.ACTION_PROVIDER_ROUTES_JSON), {
        apiKey: config.ACTION_PROVIDER_API_KEY,
        timeoutMs: config.ACTION_PROVIDER_TIMEOUT_MS,
        maximumResponseBytes: config.ACTION_PROVIDER_MAX_RESPONSE_BYTES,
        providerName: config.ACTION_PROVIDER_NAME,
      }),
      mode: "external" as const,
    });
  }
  if (config.NODE_ENV !== "production") {
    return Object.freeze({
      executor: new VerifiedDevelopmentExecutor(),
      mode: "development-simulator" as const,
    });
  }
  return Object.freeze({ executor: new DisabledActionExecutor(), mode: "disabled" as const });
}

function createContentGenerationRuntime(
  config: AppConfig,
  storage: S3ObjectStorage,
): Readonly<{
  provider: ContentGenerationPort;
  mode: "external" | "disabled" | "deterministic-development";
}> {
  if (config.CONTENT_GENERATION_ENABLED) {
    if (!config.CONTENT_PROVIDER_URL || !config.CONTENT_PROVIDER_API_KEY) {
      throw new Error("Content generation is enabled but provider configuration is incomplete.");
    }
    return Object.freeze({
      provider: new HttpContentProvider(storage, {
        endpoint: config.CONTENT_PROVIDER_URL,
        apiKey: config.CONTENT_PROVIDER_API_KEY,
        providerName: config.CONTENT_PROVIDER_NAME,
        timeoutMs: config.CONTENT_PROVIDER_TIMEOUT_MS,
        maximumResponseBytes: config.CONTENT_PROVIDER_MAX_RESPONSE_BYTES,
        maximumAssetBytes: config.CONTENT_MAX_ASSET_BYTES,
      }),
      mode: "external" as const,
    });
  }
  if (config.NODE_ENV !== "production") {
    return Object.freeze({
      provider: new DeterministicContentProvider(),
      mode: "deterministic-development" as const,
    });
  }
  return Object.freeze({ provider: new DisabledContentProvider(), mode: "disabled" as const });
}

function parseActionRoutes(value: string): HttpActionRoutes {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("Action provider routes must be an object.");
  const routes: Record<string, { executeUrl: string; verifyUrl: string }> = {};
  for (const [kind, route] of Object.entries(parsed)) {
    if (
      !isRecord(route) ||
      typeof route.executeUrl !== "string" ||
      typeof route.verifyUrl !== "string"
    ) {
      throw new Error(`Action route ${kind} is invalid.`);
    }
    routes[kind] = Object.freeze({ executeUrl: route.executeUrl, verifyUrl: route.verifyUrl });
  }
  return Object.freeze(routes);
}

function createShadowLlmRuntime(
  config: AppConfig,
  repository: InMemoryLlmRunRepository | PostgresLlmRunRepository,
  clock: { now(): Date },
  ids: { next(prefix: string): string },
): ShadowLlmService | null {
  if (!config.LLM_ENABLED) return null;
  if (!config.LLM_API_KEY) throw new Error("LLM runtime is enabled but LLM_API_KEY is missing.");
  return new ShadowLlmService(
    new DeepSeekGateway({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY }),
    repository,
    clock,
    ids,
    {
      timeoutMs: config.LLM_TIMEOUT_MS,
      defaultMaximumPromptTokens: config.LLM_DEFAULT_MAXIMUM_PROMPT_TOKENS,
      defaultMaximumOutputTokens: config.LLM_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
      dailyAccountBudgetMicrosUsd: config.LLM_DAILY_ACCOUNT_BUDGET_MICROS_USD,
    },
  );
}

function createMercadoLibreRuntime(
  config: AppConfig,
  pool: Pool | null,
  clock: { now(): Date },
): MercadoLibreService | null {
  if (!config.MELI_ENABLED) return null;
  const {
    MELI_CLIENT_ID: clientId,
    MELI_CLIENT_SECRET: clientSecret,
    MELI_REDIRECT_URI: redirectUri,
    MELI_TOKEN_VAULT_KEY_BASE64: vaultKey,
    MELI_PLASTICOV_SELLER_ID: plasticovSellerId,
    MELI_MAUSTIAN_SELLER_ID: maustianSellerId,
  } = config;
  if (
    !clientId ||
    !clientSecret ||
    !redirectUri ||
    !vaultKey ||
    !plasticovSellerId ||
    !maustianSellerId
  ) {
    throw new Error("MercadoLibre Chile runtime is enabled but incomplete.");
  }
  const states = pool
    ? new PostgresMercadoLibreOAuthStateRepository(pool)
    : new InMemoryMercadoLibreOAuthStateRepository();
  const connections = pool
    ? new PostgresMercadoLibreConnectionRepository(pool)
    : new InMemoryMercadoLibreConnectionRepository();
  const security = new NodeMercadoLibreSecurity(vaultKey);
  const client = new MercadoLibreHttpClient({
    clientId,
    clientSecret,
    redirectUri,
    tokenUrl: config.MELI_TOKEN_URL,
    apiBaseUrl: config.MELI_API_BASE_URL,
    timeoutMs: config.MELI_HTTP_TIMEOUT_MS,
    maximumScanPages: config.MELI_MAXIMUM_SCAN_PAGES,
  });
  return new MercadoLibreService(states, connections, security, client, clock, {
    clientId,
    redirectUri,
    authorizationUrl: config.MELI_AUTHORIZATION_URL,
    expectedSellerIds: Object.freeze({
      plasticov: plasticovSellerId,
      maustian: maustianSellerId,
    }),
    stateTtlMs: config.MELI_OAUTH_STATE_TTL_MS,
    refreshWindowMs: config.MELI_REFRESH_WINDOW_MS,
    refreshLeaseMs: config.MELI_REFRESH_LEASE_MS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Runtime = ReturnType<typeof createRuntime>;

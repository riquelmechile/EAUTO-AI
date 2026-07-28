import { randomUUID } from "node:crypto";
import {
  AccountBrainService,
  AgentMessageBusService,
  ContentStudioService,
  EconomicOperationsService,
  EvidenceResponseRouter,
  ProductLifecycleService,
  ProfitEngineService,
  SemanticMemoryService,
  SpecialistDaemonScheduler,
  SupplyWorkflowService,
  SPECIALIST_DAEMON_CATALOG,
  type ProductLifecycleSource,
} from "@eauto/application";
import { MiniMaxContentProvider } from "@eauto/content";
import {
  InMemoryCompanyIntelligenceRepository,
  OperationalAccountBrainSource,
  OperationalEvidenceResponder,
  OperationalSpecialistDaemonSignalProvider,
  OperationalSupplyWorkflowEvidenceReader,
  PostgresCompanyIntelligenceRepository,
  PostgresEconomicOperationsRepository,
  PostgresProductLifecycleSource,
  PostgresProfitEngineRepository,
  S3ObjectStorage,
} from "@eauto/infrastructure";
import type { AppConfig } from "./config.js";
import type { OperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";
import type { Runtime } from "./runtime.js";
import {
  loadCompanyIntelligenceConfig,
  type CompanyIntelligenceConfig,
} from "./companyIntelligenceConfig.js";

export function createCompanyIntelligenceRuntime(
  baseRuntime: Runtime,
  intelligenceRuntime: OperationalIntelligenceRuntime,
  appConfig?: AppConfig,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const config = loadCompanyIntelligenceConfig(environment);
  const clock = { now: () => new Date() };
  const ids = { next: (prefix: string) => `${prefix}_${randomUUID()}` };
  const repository = baseRuntime.databasePool
    ? new PostgresCompanyIntelligenceRepository(baseRuntime.databasePool)
    : new InMemoryCompanyIntelligenceRepository();
  const messages = new AgentMessageBusService(repository, clock, ids);
  const evidenceRouter = new EvidenceResponseRouter(
    [new OperationalEvidenceResponder(intelligenceRuntime.evidenceReader)],
    repository,
    clock,
    ids,
    {
      workerId: `${config.COMPANY_INTELLIGENCE_WORKER_ID}-evidence-${process.pid}`,
      leaseMs: config.COMPANY_INTELLIGENCE_LEASE_MS,
      maximumAttempts: config.COMPANY_INTELLIGENCE_MAX_ATTEMPTS,
    },
  );
  const memory = new SemanticMemoryService(repository, clock, ids);
  const accountBrain = new AccountBrainService(
    repository,
    new OperationalAccountBrainSource(intelligenceRuntime.evidenceReader, memory),
    clock,
    ids,
  );
  const supply = new SupplyWorkflowService(
    repository,
    new OperationalSupplyWorkflowEvidenceReader(intelligenceRuntime.evidenceReader),
    clock,
    ids,
  );
  const lifecycleSource: ProductLifecycleSource = baseRuntime.databasePool
    ? new PostgresProductLifecycleSource(
        baseRuntime.databasePool,
        config.COMPANY_INTELLIGENCE_MAX_EVIDENCE_AGE_MS,
      )
    : new EmptyProductLifecycleSource();
  const lifecycle = new ProductLifecycleService(repository, lifecycleSource, clock);
  const daemons = new SpecialistDaemonScheduler(
    SPECIALIST_DAEMON_CATALOG,
    repository,
    new OperationalSpecialistDaemonSignalProvider(intelligenceRuntime.evidenceReader),
    intelligenceRuntime.intelligence,
    intelligenceRuntime.workOrders,
    clock,
    ids,
    {
      workerId: `${config.COMPANY_INTELLIGENCE_WORKER_ID}-daemons-${process.pid}`,
      leaseMs: config.COMPANY_INTELLIGENCE_LEASE_MS,
    },
  );
  const economic = baseRuntime.databasePool
    ? createEconomicOperations(baseRuntime)
    : null;
  const creativeStudio =
    config.CONTENT_PROVIDER_KIND === "minimax" && appConfig
      ? new ContentStudioService(
          new MiniMaxContentProvider(
            new S3ObjectStorage({
              bucket: appConfig.OBJECT_STORAGE_BUCKET,
              region: appConfig.OBJECT_STORAGE_REGION,
              ...(appConfig.OBJECT_STORAGE_PUBLIC_ENDPOINT
                ? { publicEndpoint: appConfig.OBJECT_STORAGE_PUBLIC_ENDPOINT }
                : {}),
              ...(appConfig.OBJECT_STORAGE_INTERNAL_ENDPOINT
                ? { internalEndpoint: appConfig.OBJECT_STORAGE_INTERNAL_ENDPOINT }
                : {}),
              ...(appConfig.OBJECT_STORAGE_ACCESS_KEY
                ? { accessKeyId: appConfig.OBJECT_STORAGE_ACCESS_KEY }
                : {}),
              ...(appConfig.OBJECT_STORAGE_SECRET_KEY
                ? { secretAccessKey: appConfig.OBJECT_STORAGE_SECRET_KEY }
                : {}),
              forcePathStyle: appConfig.OBJECT_STORAGE_FORCE_PATH_STYLE,
            }),
            {
              apiKey: config.MINIMAX_API_KEY ?? "",
              imageModel: config.MINIMAX_IMAGE_MODEL,
              videoModel: config.MINIMAX_VIDEO_MODEL,
              promptVersion: config.MINIMAX_PROMPT_VERSION,
              generateVideo: config.MINIMAX_GENERATE_VIDEO,
              timeoutMs: appConfig.CONTENT_PROVIDER_TIMEOUT_MS,
              pollIntervalMs: config.MINIMAX_POLL_INTERVAL_MS,
              maximumPolls: config.MINIMAX_MAXIMUM_POLLS,
              maximumResponseBytes: appConfig.CONTENT_PROVIDER_MAX_RESPONSE_BYTES,
              maximumAssetBytes: appConfig.CONTENT_MAX_ASSET_BYTES,
            },
          ),
          baseRuntime.assets,
        )
      : null;

  return Object.freeze({
    config,
    repository,
    messages,
    evidenceRouter,
    memory,
    accountBrain,
    daemons,
    supply,
    lifecycle,
    economic,
    creativeStudio,
    sourceImageUploads: baseRuntime.sourceImageUploads,
    enabled: config.COMPANY_INTELLIGENCE_ENABLED,
    async initialize(): Promise<void> {
      if (!config.COMPANY_INTELLIGENCE_ENABLED) return;
      for (const accountId of config.accountIds) {
        await daemons.initialize({ organizationId: "maustian", accountId });
      }
    },
    async processBatch(): Promise<Readonly<{
      evidence: Awaited<ReturnType<EvidenceResponseRouter["processBatch"]>>;
      daemons: Awaited<ReturnType<SpecialistDaemonScheduler["runOnce"]>>;
    }>> {
      if (!config.COMPANY_INTELLIGENCE_ENABLED) {
        return Object.freeze({
          evidence: { leased: 0, fulfilled: 0, failed: 0 },
          daemons: { leased: 0, queued: 0, skipped: 0, waitingEvidence: 0, failed: 0 },
        });
      }
      const [evidence, daemonSummary] = await Promise.all([
        evidenceRouter.processBatch(config.COMPANY_INTELLIGENCE_BATCH_SIZE),
        daemons.runOnce(config.COMPANY_INTELLIGENCE_BATCH_SIZE),
      ]);
      return Object.freeze({ evidence, daemons: daemonSummary });
    },
    close: () => Promise.resolve(),
  });
}

export type CompanyIntelligenceRuntime = ReturnType<typeof createCompanyIntelligenceRuntime>;
export type { CompanyIntelligenceConfig };

function createEconomicOperations(baseRuntime: Runtime): EconomicOperationsService {
  const pool = baseRuntime.databasePool;
  if (!pool) throw new Error("Economic operations require PostgreSQL.");
  const profitRepository = new PostgresProfitEngineRepository(pool);
  return new EconomicOperationsService(
    new PostgresEconomicOperationsRepository(pool),
    new ProfitEngineService(profitRepository, profitRepository, profitRepository),
  );
}

class EmptyProductLifecycleSource implements ProductLifecycleSource {
  readLifecycleInput() {
    return Promise.resolve({
      listingActive: null,
      availableQuantity: null,
      soldUnits30d: null,
      soldUnits90d: null,
      visits30d: null,
      lastSaleAt: null,
      marginBps: null,
      seasonInWindow: null,
      seasonEvidenceConfidence: null,
      evidenceFresh: false,
      evidenceRefs: Object.freeze([]),
    });
  }

  listListingIds(): Promise<readonly string[]> {
    return Promise.resolve(Object.freeze([]));
  }
}

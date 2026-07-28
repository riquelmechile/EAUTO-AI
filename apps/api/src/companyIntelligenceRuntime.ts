import { randomUUID } from "node:crypto";
import {
  AccountBrainService,
  AgentMessageBusService,
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
} from "@eauto/infrastructure";
import type { OperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";
import type { Runtime } from "./runtime.js";
import {
  loadCompanyIntelligenceConfig,
  type CompanyIntelligenceConfig,
} from "./companyIntelligenceConfig.js";

export function createCompanyIntelligenceRuntime(
  baseRuntime: Runtime,
  intelligenceRuntime: OperationalIntelligenceRuntime,
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
    ? new EconomicOperationsService(
        new PostgresEconomicOperationsRepository(baseRuntime.databasePool),
        new ProfitEngineService(
          new PostgresProfitEngineRepository(baseRuntime.databasePool),
          new PostgresProfitEngineRepository(baseRuntime.databasePool),
          new PostgresProfitEngineRepository(baseRuntime.databasePool),
        ),
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

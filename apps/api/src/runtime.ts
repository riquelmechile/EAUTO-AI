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
  ContentStudioService,
  OutboxProcessor,
  type OutboxEventHandler,
} from "@eauto/application";
import { DeterministicContentProvider } from "@eauto/content";
import {
  InMemoryAccountRepository,
  InMemoryActionRepository,
  InMemoryContentAssetRepository,
  InMemoryOutboxRepository,
  InMemoryReceiptRepository,
  PostgresAccountRepository,
  PostgresActionRepository,
  PostgresContentAssetRepository,
  PostgresOutboxRepository,
  PostgresReceiptRepository,
} from "@eauto/infrastructure";
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

class VerifiedDevelopmentExecutor {
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
  const clock = { now: () => new Date() };
  const ids = { next: (prefix: string) => `${prefix}_${randomUUID()}` };
  const actionService = new ActionService(
    actionRepository,
    receiptRepository,
    new VerifiedDevelopmentExecutor(),
    clock,
    ids,
  );
  const contentStudio = new ContentStudioService(
    new DeterministicContentProvider(),
    assetRepository,
  );
  const outboxProcessor = new OutboxProcessor(outbox, lifecycleHandlers, {
    workerId: `${config.OUTBOX_WORKER_ID}-${process.pid}`,
    leaseMs: config.OUTBOX_LEASE_MS,
    maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
    baseRetryMs: config.OUTBOX_BASE_RETRY_MS,
    maxRetryMs: config.OUTBOX_MAX_RETRY_MS,
    now: () => new Date(),
  });

  return {
    accounts: accountRepository,
    actions: actionRepository,
    receipts: receiptRepository,
    assets: assetRepository,
    outbox,
    actionService,
    contentStudio,
    outboxProcessor,
    persistenceMode: pool ? ("postgres" as const) : ("in-memory-development" as const),
    close: () => pool?.end() ?? Promise.resolve(),
  };
}

export type Runtime = ReturnType<typeof createRuntime>;

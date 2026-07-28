import {
  MarginAuditDaemon,
  ProfitEngineService,
  SupplierStockDaemon,
  SupplierStockService,
} from "@eauto/application";
import {
  PostgresProfitEngineRepository,
  PostgresSupplierStockRepository,
} from "@eauto/infrastructure";
import { loadConfig } from "./config.js";
import { createOperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);
const intelligenceRuntime = createOperationalIntelligenceRuntime(runtime, config);
const marginAuditRepository = runtime.databasePool
  ? new PostgresProfitEngineRepository(runtime.databasePool)
  : null;
const marginAuditDaemon = marginAuditRepository
  ? new MarginAuditDaemon(
      new ProfitEngineService(marginAuditRepository, marginAuditRepository, marginAuditRepository),
      marginAuditRepository,
      marginAuditRepository,
      {
        workerId: `${config.OUTBOX_WORKER_ID}-margin-${process.pid}`,
        leaseMs: config.OUTBOX_LEASE_MS,
        successIntervalMs: 15 * 60_000,
        retryIntervalMs: 60_000,
        now: () => new Date(),
      },
    )
  : null;
const supplierStockRepository = runtime.databasePool
  ? new PostgresSupplierStockRepository(runtime.databasePool)
  : null;
const supplierStockDaemon = supplierStockRepository
  ? new SupplierStockDaemon(
      new SupplierStockService(
        supplierStockRepository,
        supplierStockRepository,
        supplierStockRepository,
        supplierStockRepository,
      ),
      supplierStockRepository,
      {
        workerId: `${config.OUTBOX_WORKER_ID}-supplier-stock-${process.pid}`,
        leaseMs: config.OUTBOX_LEASE_MS,
        successIntervalMs: 15 * 60_000,
        retryIntervalMs: 60_000,
        now: () => new Date(),
      },
    )
  : null;
let stopping = false;
let closed = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

async function run(): Promise<void> {
  log("info", "worker-started", {
    outboxWorkerId: `${config.OUTBOX_WORKER_ID}-${process.pid}`,
    mercadoLibreNotifications: runtime.mercadoLibreNotificationProcessor !== null,
    intelligenceWorker: intelligenceRuntime.processor !== null,
    marginAuditWorker: marginAuditDaemon !== null,
    supplierStockWorker: supplierStockDaemon !== null,
    persistence: runtime.persistenceMode,
  });

  const pollInterval = Math.min(
    config.OUTBOX_POLL_INTERVAL_MS,
    runtime.mercadoLibreNotificationProcessor
      ? config.MELI_NOTIFICATION_POLL_INTERVAL_MS
      : config.OUTBOX_POLL_INTERVAL_MS,
    intelligenceRuntime.processor
      ? intelligenceRuntime.config.INTELLIGENCE_POLL_INTERVAL_MS
      : config.OUTBOX_POLL_INTERVAL_MS,
  );

  while (!stopping) {
    let cycleFailed = false;
    let outbox = { claimed: 0, processed: 0, retried: 0, dead: 0 };
    let notifications = { leased: 0, processed: 0, failed: 0 };
    let intelligence = { leased: 0, completed: 0, failed: 0 };
    let marginAudit = { leased: 0, audited: 0, findings: 0, failed: 0 };
    let supplierStock = { leased: 0, evaluated: 0, proposals: 0, reaudits: 0, failed: 0 };

    try {
      outbox = await runtime.outboxProcessor.runOnce(config.OUTBOX_BATCH_SIZE);
    } catch (error) {
      cycleFailed = true;
      logProcessorFailure("outbox", error);
    }

    if (runtime.mercadoLibreNotificationProcessor) {
      try {
        notifications = await runtime.mercadoLibreNotificationProcessor.processBatch();
      } catch (error) {
        cycleFailed = true;
        logProcessorFailure("mercadolibre-notifications", error);
      }
    }

    if (intelligenceRuntime.processor) {
      try {
        intelligence = await intelligenceRuntime.processor.processBatch();
      } catch (error) {
        cycleFailed = true;
        logProcessorFailure("operational-intelligence", error);
      }
    }

    if (marginAuditDaemon) {
      try {
        marginAudit = await marginAuditDaemon.runOnce(config.OUTBOX_BATCH_SIZE);
      } catch (error) {
        cycleFailed = true;
        logProcessorFailure("margin-audit", error);
      }
    }

    if (supplierStockDaemon) {
      try {
        supplierStock = await supplierStockDaemon.runOnce(config.OUTBOX_BATCH_SIZE);
      } catch (error) {
        cycleFailed = true;
        logProcessorFailure("supplier-stock", error);
      }
    }

    if (
      outbox.claimed > 0 ||
      notifications.leased > 0 ||
      intelligence.leased > 0 ||
      marginAudit.leased > 0 ||
      supplierStock.leased > 0
    ) {
      log("info", "worker-cycle", {
        outbox,
        mercadoLibreNotifications: notifications,
        intelligence,
        marginAudit,
        supplierStock,
      });
    }
    if (
      cycleFailed ||
      (outbox.claimed === 0 &&
        notifications.leased === 0 &&
        intelligence.leased === 0 &&
        marginAudit.leased === 0 &&
        supplierStock.leased === 0)
    ) {
      await delay(pollInterval);
    }
  }

  await closeRuntimes();
  log("info", "worker-stopped", {});
}

function logProcessorFailure(processor: string, error: unknown): void {
  log("error", "worker-processor-failed", {
    processor,
    error: sanitizeError(error),
  });
}

function log(level: "info" | "error", message: string, details: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...details });
  if (level === "error") console.error(line);
  else console.log(line);
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown worker error")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeRuntimes(): Promise<void> {
  if (closed) return;
  closed = true;
  await Promise.allSettled([intelligenceRuntime.close(), runtime.close()]);
}

void run().catch(async (error: unknown) => {
  log("error", "worker-crashed", { error: sanitizeError(error) });
  await closeRuntimes();
  process.exitCode = 1;
});

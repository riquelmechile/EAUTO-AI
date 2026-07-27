import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

async function run(): Promise<void> {
  console.log(
    JSON.stringify({
      level: "info",
      message: "worker-started",
      outboxWorkerId: `${config.OUTBOX_WORKER_ID}-${process.pid}`,
      mercadoLibreNotifications: runtime.mercadoLibreNotificationProcessor !== null,
      persistence: runtime.persistenceMode,
    }),
  );

  const pollInterval = Math.min(
    config.OUTBOX_POLL_INTERVAL_MS,
    runtime.mercadoLibreNotificationProcessor
      ? config.MELI_NOTIFICATION_POLL_INTERVAL_MS
      : config.OUTBOX_POLL_INTERVAL_MS,
  );

  while (!stopping) {
    const outbox = await runtime.outboxProcessor.runOnce(config.OUTBOX_BATCH_SIZE);
    const notifications = runtime.mercadoLibreNotificationProcessor
      ? await runtime.mercadoLibreNotificationProcessor.processBatch()
      : { leased: 0, processed: 0, failed: 0 };

    if (outbox.claimed > 0 || notifications.leased > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "worker-cycle",
          outbox,
          mercadoLibreNotifications: notifications,
        }),
      );
    }
    if (outbox.claimed === 0 && notifications.leased === 0) await delay(pollInterval);
  }

  await runtime.close();
  console.log(JSON.stringify({ level: "info", message: "worker-stopped" }));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void run().catch(async (error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "worker-crashed",
      error: error instanceof Error ? error.message : "Unknown worker error",
    }),
  );
  await runtime.close();
  process.exitCode = 1;
});

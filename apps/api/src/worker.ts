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
      message: "outbox-worker-started",
      workerId: `${config.OUTBOX_WORKER_ID}-${process.pid}`,
      persistence: runtime.persistenceMode,
    }),
  );

  while (!stopping) {
    const result = await runtime.outboxProcessor.runOnce(config.OUTBOX_BATCH_SIZE);
    if (result.claimed > 0) {
      console.log(JSON.stringify({ level: "info", message: "outbox-batch", ...result }));
    }
    if (result.claimed === 0) await delay(config.OUTBOX_POLL_INTERVAL_MS);
  }

  await runtime.close();
  console.log(JSON.stringify({ level: "info", message: "outbox-worker-stopped" }));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void run().catch(async (error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "outbox-worker-crashed",
      error: error instanceof Error ? error.message : "Unknown worker error",
    }),
  );
  await runtime.close();
  process.exitCode = 1;
});

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { registerMercadoLibreRoutes } from "./mercadoLibreRoutes.js";
import { createMercadoLibreRuntime } from "./mercadoLibreRuntime.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);
const mercadoLibre = createMercadoLibreRuntime(config);
const app = await buildApp(config, runtime);
await registerMercadoLibreRoutes(app, config, runtime, mercadoLibre);
app.addHook("onClose", async () => mercadoLibre.close());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

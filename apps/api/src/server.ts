import { buildCompanyApp } from "./companyApp.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildCompanyApp(config);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

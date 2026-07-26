import { existsSync } from "node:fs";
import { request } from "node:http";

const required = [
  "package.json",
  "apps/api/package.json",
  "apps/mobile/app.json",
  "infra/compose/docker-compose.yml",
];
let failed = false;
for (const path of required) {
  const ok = existsSync(new URL(`../${path}`, import.meta.url));
  console.log(`${ok ? "✓" : "✗"} ${path}`);
  failed ||= !ok;
}

if (process.argv.includes("--api")) {
  await new Promise((resolve) => {
    const req = request("http://127.0.0.1:3000/ready", (res) => {
      console.log(`${res.statusCode === 200 ? "✓" : "✗"} API /ready (${res.statusCode})`);
      failed ||= res.statusCode !== 200;
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", (error) => {
      console.error(`✗ API /ready: ${error.message}`);
      failed = true;
      resolve();
    });
    req.end();
  });
}

if (failed) process.exitCode = 1;

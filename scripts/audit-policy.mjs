import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ALLOWED_ROOT_ADVISORIES = new Set([
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
]);
const ALLOWED_PACKAGE = "image-size";
const ALLOWED_VERSION = "1.2.1";
const ALLOWED_NODE = "node_modules/image-size";
const EXPIRES_AT = new Date("2026-09-14T23:59:59Z");

function fail(message) {
  console.error(`audit-policy: ${message}`);
  process.exit(1);
}

if (Date.now() > EXPIRES_AT.getTime()) {
  fail(
    `la excepción temporal para ${ALLOWED_PACKAGE} expiró el ${EXPIRES_AT.toISOString()}; revise upstream antes de continuar`,
  );
}

const audit = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

if (audit.error) {
  fail(`no se pudo ejecutar npm audit: ${audit.error.message}`);
}

let report;
try {
  report = JSON.parse(audit.stdout || "{}");
} catch (error) {
  fail(`npm audit no devolvió JSON válido: ${error.message}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);

if (audit.status === 0 && names.length === 0) {
  console.log("audit-policy: 0 vulnerabilidades conocidas");
  process.exit(0);
}

if (names.length === 0) {
  fail(`npm audit terminó con código ${audit.status} sin vulnerabilidades parseables`);
}

const packageJson = JSON.parse(
  readFileSync(`node_modules/${ALLOWED_PACKAGE}/package.json`, "utf8"),
);
if (packageJson.version !== ALLOWED_VERSION) {
  fail(
    `${ALLOWED_PACKAGE} cambió de ${ALLOWED_VERSION} a ${packageJson.version}; la excepción debe reevaluarse`,
  );
}

const root = vulnerabilities[ALLOWED_PACKAGE];
if (!root) {
  fail(`existen vulnerabilidades, pero falta la única raíz permitida: ${ALLOWED_PACKAGE}`);
}
if (root.isDirect) {
  fail(`${ALLOWED_PACKAGE} no puede convertirse en dependencia directa`);
}
if (
  root.nodes?.length !== 1 ||
  root.nodes[0] !== ALLOWED_NODE ||
  root.severity !== "high"
) {
  fail(`el alcance de ${ALLOWED_PACKAGE} cambió y requiere revisión`);
}

function collectRootAdvisories(startName) {
  const pending = [startName];
  const visited = new Set();
  const roots = new Set();

  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) {
      continue;
    }
    visited.add(name);

    const vulnerability = vulnerabilities[name];
    if (!vulnerability) {
      fail(`npm audit referencia una vulnerabilidad desconocida: ${name}`);
    }

    for (const via of vulnerability.via ?? []) {
      if (typeof via === "string") {
        if (!vulnerabilities[via]) {
          fail(`npm audit referencia una dependencia vulnerable desconocida: ${name} -> ${via}`);
        }
        pending.push(via);
        continue;
      }

      if (!via?.url) {
        fail(`advisory sin URL para ${name}`);
      }
      roots.add(via.url);
    }
  }

  if (roots.size === 0) {
    fail(`no se pudo demostrar la raíz de la vulnerabilidad ${startName}`);
  }
  return roots;
}

for (const name of names) {
  const roots = collectRootAdvisories(name);
  for (const advisory of roots) {
    if (!ALLOWED_ROOT_ADVISORIES.has(advisory)) {
      fail(`vulnerabilidad no permitida en ${name}: ${advisory}`);
    }
  }
}

const observedRootUrls = new Set(
  (root.via ?? [])
    .filter((via) => typeof via !== "string" && via?.url)
    .map((via) => via.url),
);
if (
  observedRootUrls.size !== ALLOWED_ROOT_ADVISORIES.size ||
  [...ALLOWED_ROOT_ADVISORIES].some((url) => !observedRootUrls.has(url))
) {
  fail(`cambió el conjunto exacto de advisories permitidas para ${ALLOWED_PACKAGE}`);
}

console.warn(
  `audit-policy: excepción temporal y acotada: ${names.length} entradas de npm audit derivan exclusivamente de ${ALLOWED_PACKAGE}@${ALLOWED_VERSION}; expira ${EXPIRES_AT.toISOString()}`,
);
console.warn(
  `audit-policy: advisories permitidas: ${[...ALLOWED_ROOT_ADVISORIES].join(", ")}`,
);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function importedModules(source: string): string[] {
  const modules: string[] = [];
  const importPattern = /(?:from\s+|import\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const moduleName = match[1];
    if (moduleName) modules.push(moduleName);
  }
  return modules;
}

describe("architecture", () => {
  it("keeps domain independent from infrastructure and frameworks", () => {
    const forbidden = [
      "fastify",
      "react",
      "pg",
      "redis",
      "openai",
      "expo",
      "@eauto/infrastructure",
    ];
    for (const file of files("packages/domain/src").filter((path) => path.endsWith(".ts"))) {
      const imports = importedModules(readFileSync(file, "utf8"));
      for (const dependency of forbidden) {
        const importsForbiddenDependency = imports.some(
          (moduleName) => moduleName === dependency || moduleName.startsWith(`${dependency}/`),
        );
        expect(importsForbiddenDependency, `${file} imports ${dependency}`).toBe(false);
      }
    }
  });
});

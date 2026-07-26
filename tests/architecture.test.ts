import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("architecture", () => {
  it("keeps domain independent from infrastructure and frameworks", () => {
    const forbidden = ["fastify", "react", "pg", "redis", "openai", "expo", "@eauto/infrastructure"];
    for (const file of files("packages/domain/src").filter((path) => path.endsWith(".ts"))) {
      const source = readFileSync(file, "utf8");
      for (const dependency of forbidden) expect(source, `${file} imports ${dependency}`).not.toContain(dependency);
    }
  });
});

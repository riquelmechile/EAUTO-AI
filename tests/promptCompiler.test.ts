import { describe, expect, it } from "vitest";
import { compilePrompt } from "../packages/agent-kernel/src/promptCompiler.js";

const base = {
  constitution: "stable constitution",
  globalSafetyPolicy: "stable safety",
  toolContract: "stable tools",
  agentIdentity: "pricing-agent-v1",
  accountPolicy: "plasticov-policy-v1",
  skillManifest: "pricing-skill-v1",
  recoveredContext: "lesson one",
  volatileInput: "price changed",
};

describe("prompt compiler", () => {
  it("keeps cache prefix stable when volatile evidence changes", () => {
    const first = compilePrompt(base);
    const second = compilePrompt({ ...base, volatileInput: "stock changed", recoveredContext: "lesson two" });
    expect(first.stableHash).toBe(second.stableHash);
    expect(first.fullHash).not.toBe(second.fullHash);
  });
});

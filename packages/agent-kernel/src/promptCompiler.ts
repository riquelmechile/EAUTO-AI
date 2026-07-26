import { createHash } from "node:crypto";

export type PromptBlock = Readonly<{ name: string; content: string; hash: string }>;
export type CompiledPrompt = Readonly<{
  stablePrefix: string;
  recoveredContext: string;
  volatileInput: string;
  stableHash: string;
  fullHash: string;
}>;

export type PromptCompilerInput = Readonly<{
  constitution: string;
  globalSafetyPolicy: string;
  toolContract: string;
  agentIdentity: string;
  accountPolicy: string;
  skillManifest: string;
  recoveredContext: string;
  volatileInput: string;
}>;

export function compilePrompt(input: PromptCompilerInput): CompiledPrompt {
  const stablePrefix = [
    "# Constitution",
    normalizeStable(input.constitution),
    "# Safety Policy",
    normalizeStable(input.globalSafetyPolicy),
    "# Tool Contract",
    normalizeStable(input.toolContract),
    "# Agent Identity",
    normalizeStable(input.agentIdentity),
    "# Account Policy",
    normalizeStable(input.accountPolicy),
    "# Active Skill",
    normalizeStable(input.skillManifest),
  ].join("\n\n");

  const recoveredContext = input.recoveredContext.trim();
  const volatileInput = input.volatileInput.trim();
  const full = `${stablePrefix}\n\n# Retrieved Context\n${recoveredContext}\n\n# Current Work\n${volatileInput}`;

  return Object.freeze({
    stablePrefix,
    recoveredContext,
    volatileInput,
    stableHash: hash(stablePrefix),
    fullHash: hash(full),
  });
}

function normalizeStable(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

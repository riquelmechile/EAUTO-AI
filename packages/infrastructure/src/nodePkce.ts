import { createHash, randomBytes } from "node:crypto";
import type { PkcePort } from "@eauto/application";

export class NodePkce implements PkcePort {
  create(): Readonly<{
    state: string;
    stateHash: string;
    codeVerifier: string;
    codeChallenge: string;
  }> {
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    return Object.freeze({
      state,
      stateHash: this.hashState(state),
      codeVerifier,
      codeChallenge: createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
    });
  }

  hashState(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}

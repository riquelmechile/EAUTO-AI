import { createHash, randomBytes } from "node:crypto";
import type { SessionSecretPort } from "@eauto/application";

export class NodeSessionSecrets implements SessionSecretPort {
  generateToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}

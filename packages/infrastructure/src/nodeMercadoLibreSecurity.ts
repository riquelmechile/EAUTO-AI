import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { MercadoLibreSecurityPort } from "@eauto/application";

export class NodeMercadoLibreSecurity implements MercadoLibreSecurityPort {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32) {
      throw new Error("MELI_TOKEN_VAULT_KEY_BASE64 must decode to exactly 32 bytes.");
    }
  }

  createAuthorizationSecrets(): Readonly<{
    state: string;
    stateHash: string;
    verifier: string;
    challenge: string;
  }> {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return Object.freeze({ state, stateHash: this.hash(state), verifier, challenge });
  }

  hash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  randomId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  protect(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  reveal(protectedValue: string, context: string): string {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = protectedValue.split(".");
    if (
      version !== "v1" ||
      ivEncoded === undefined ||
      tagEncoded === undefined ||
      ciphertextEncoded === undefined
    ) {
      throw new Error("Unsupported MercadoLibre protected secret format.");
    }
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    const ciphertext = Buffer.from(ciphertextEncoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  equalsHash(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}

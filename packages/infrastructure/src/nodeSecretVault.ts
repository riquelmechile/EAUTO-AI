import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretVault } from "@eauto/application";

export class NodeSecretVault implements SecretVault {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.byteLength !== 32) {
      throw new Error("Secret vault key must decode to exactly 32 bytes.");
    }
    this.key = key;
  }

  seal(plaintext: string, associatedData: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  open(ciphertext: string, associatedData: string): string {
    const [version, ivEncoded, tagEncoded, encryptedEncoded] = ciphertext.split(".");
    if (version !== "v1" || !ivEncoded || !tagEncoded || encryptedEncoded === undefined) {
      throw new Error("Invalid secret vault envelope.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivEncoded, "base64url"),
    );
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

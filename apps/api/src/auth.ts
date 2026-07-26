import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthenticationError, ROLES, type ActorIdentity } from "@eauto/domain";

const operatorIdentitySchema = z.object({
  id: z.string().min(1),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/i),
  organizationId: z.string().min(1),
  roles: z.array(z.enum(ROLES)).min(1),
  accountIds: z.array(z.string().min(1)).min(1),
});

export type Authenticator = {
  authenticate(authorizationHeader: string | undefined): ActorIdentity;
  readonly mode: "disabled" | "static-token";
};

export function createAuthenticator(input: {
  mode: "disabled" | "static-token";
  identitiesJson: string;
  nodeEnv: "development" | "test" | "production";
}): Authenticator {
  if (input.mode === "disabled") {
    if (input.nodeEnv === "production") {
      throw new Error("Authentication cannot be disabled in production.");
    }
    const developmentActor: ActorIdentity = Object.freeze({
      id: "development-owner",
      organizationId: "maustian",
      roles: ["owner"],
      accountIds: ["*"],
    });
    return {
      mode: "disabled",
      authenticate: () => developmentActor,
    };
  }

  const parsedJson: unknown = JSON.parse(input.identitiesJson);
  const identities = z.array(operatorIdentitySchema).min(1).parse(parsedJson);

  return {
    mode: "static-token",
    authenticate: (authorizationHeader) => {
      const token = parseBearerToken(authorizationHeader);
      const presentedHash = Buffer.from(hashToken(token), "hex");
      for (const identity of identities) {
        const expectedHash = Buffer.from(identity.tokenHash, "hex");
        if (
          presentedHash.length === expectedHash.length &&
          timingSafeEqual(presentedHash, expectedHash)
        ) {
          return Object.freeze({
            id: identity.id,
            organizationId: identity.organizationId,
            roles: Object.freeze([...identity.roles]),
            accountIds: Object.freeze([...identity.accountIds]),
          });
        }
      }
      throw new AuthenticationError("Invalid bearer token.");
    },
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) throw new AuthenticationError();
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) throw new AuthenticationError("A Bearer token is required.");
  return match[1];
}

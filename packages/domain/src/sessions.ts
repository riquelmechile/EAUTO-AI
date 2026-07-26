import type { ActorIdentity } from "./access.js";

export type OperatorSession = Readonly<{
  id: string;
  actor: ActorIdentity;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}>;

export type IssuedSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  actor: ActorIdentity;
}>;

export class SessionExpiredError extends Error {
  readonly code = "session-expired";

  constructor(message = "The operator session has expired.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class SessionRevokedError extends Error {
  readonly code = "session-revoked";

  constructor(message = "The operator session has been revoked.") {
    super(message);
    this.name = "SessionRevokedError";
  }
}

export function assertActiveAccessSession(session: OperatorSession, now: Date): void {
  assertNotRevoked(session);
  if (Date.parse(session.accessExpiresAt) <= now.getTime()) throw new SessionExpiredError();
}

export function assertActiveRefreshSession(session: OperatorSession, now: Date): void {
  assertNotRevoked(session);
  if (Date.parse(session.refreshExpiresAt) <= now.getTime()) {
    throw new SessionExpiredError("The refresh session has expired.");
  }
}

function assertNotRevoked(session: OperatorSession): void {
  if (session.revokedAt !== null) throw new SessionRevokedError();
}

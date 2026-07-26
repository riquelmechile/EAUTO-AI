import {
  AuthenticationError,
  assertActiveAccessSession,
  assertActiveRefreshSession,
  type ActorIdentity,
  type IssuedSession,
  type OperatorSession,
} from "@eauto/domain";
import type { Clock, IdGenerator } from "./ports.js";

export type SessionRepository = {
  save(session: OperatorSession): Promise<void>;
  findByAccessTokenHash(hash: string): Promise<OperatorSession | null>;
  findByRefreshTokenHash(hash: string): Promise<OperatorSession | null>;
  rotate(input: {
    currentRefreshTokenHash: string;
    replacement: OperatorSession;
  }): Promise<boolean>;
  revoke(input: { sessionId: string; revokedAt: string }): Promise<void>;
};

export type SessionSecretPort = {
  generateToken(): string;
  hashToken(token: string): string;
};

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly secrets: SessionSecretPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly ttl: Readonly<{ accessMs: number; refreshMs: number }>,
  ) {}

  async issue(actor: ActorIdentity): Promise<IssuedSession> {
    const now = this.clock.now();
    const accessToken = this.secrets.generateToken();
    const refreshToken = this.secrets.generateToken();
    const session: OperatorSession = Object.freeze({
      id: this.ids.next("session"),
      actor,
      accessTokenHash: this.secrets.hashToken(accessToken),
      refreshTokenHash: this.secrets.hashToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + this.ttl.accessMs).toISOString(),
      refreshExpiresAt: new Date(now.getTime() + this.ttl.refreshMs).toISOString(),
      createdAt: now.toISOString(),
      rotatedAt: null,
      revokedAt: null,
    });
    await this.sessions.save(session);
    return this.toIssued(session, accessToken, refreshToken);
  }

  async authenticateAccess(accessToken: string): Promise<ActorIdentity> {
    const session = await this.sessions.findByAccessTokenHash(this.secrets.hashToken(accessToken));
    if (!session) throw new AuthenticationError("Invalid access session.");
    assertActiveAccessSession(session, this.clock.now());
    return session.actor;
  }

  async rotate(refreshToken: string): Promise<IssuedSession> {
    const currentRefreshTokenHash = this.secrets.hashToken(refreshToken);
    const current = await this.sessions.findByRefreshTokenHash(currentRefreshTokenHash);
    if (!current) throw new AuthenticationError("Invalid refresh session.");
    const now = this.clock.now();
    assertActiveRefreshSession(current, now);

    const nextAccessToken = this.secrets.generateToken();
    const nextRefreshToken = this.secrets.generateToken();
    const rotated: OperatorSession = Object.freeze({
      ...current,
      accessTokenHash: this.secrets.hashToken(nextAccessToken),
      refreshTokenHash: this.secrets.hashToken(nextRefreshToken),
      accessExpiresAt: new Date(now.getTime() + this.ttl.accessMs).toISOString(),
      refreshExpiresAt: new Date(now.getTime() + this.ttl.refreshMs).toISOString(),
      rotatedAt: now.toISOString(),
    });
    const replaced = await this.sessions.rotate({ currentRefreshTokenHash, replacement: rotated });
    if (!replaced) throw new AuthenticationError("Refresh session was already rotated.");
    return this.toIssued(rotated, nextAccessToken, nextRefreshToken);
  }

  async revokeAccess(accessToken: string): Promise<void> {
    const session = await this.sessions.findByAccessTokenHash(this.secrets.hashToken(accessToken));
    if (!session) return;
    await this.sessions.revoke({
      sessionId: session.id,
      revokedAt: this.clock.now().toISOString(),
    });
  }

  private toIssued(
    session: OperatorSession,
    accessToken: string,
    refreshToken: string,
  ): IssuedSession {
    return Object.freeze({
      accessToken,
      refreshToken,
      accessExpiresAt: session.accessExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      actor: session.actor,
    });
  }
}

import type { OperatorSession } from "@eauto/domain";
import type { SessionRepository } from "@eauto/application";

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, OperatorSession>();

  save(session: OperatorSession): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  findByAccessTokenHash(hash: string): Promise<OperatorSession | null> {
    return Promise.resolve(
      [...this.sessions.values()].find((session) => session.accessTokenHash === hash) ?? null,
    );
  }

  findByRefreshTokenHash(hash: string): Promise<OperatorSession | null> {
    return Promise.resolve(
      [...this.sessions.values()].find((session) => session.refreshTokenHash === hash) ?? null,
    );
  }

  revoke(input: { sessionId: string; revokedAt: string }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (!session) return Promise.resolve();
    this.sessions.set(
      session.id,
      Object.freeze({
        ...session,
        revokedAt: input.revokedAt,
      }),
    );
    return Promise.resolve();
  }
}

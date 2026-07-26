import { describe, expect, it } from "vitest";
import { AuthenticationError, SessionRevokedError, type ActorIdentity } from "@eauto/domain";
import { SessionService } from "@eauto/application";
import { InMemorySessionRepository } from "@eauto/infrastructure";

const actor: ActorIdentity = Object.freeze({
  id: "sebastian",
  organizationId: "maustian",
  roles: ["owner"],
  accountIds: ["plasticov", "maustian"],
});

function fixture() {
  let tokenSequence = 0;
  let idSequence = 0;
  const repository = new InMemorySessionRepository();
  const service = new SessionService(
    repository,
    {
      generateToken: () => `token-${++tokenSequence}`,
      hashToken: (token) => `hash:${token}`,
    },
    { now: () => new Date("2026-07-26T12:00:00.000Z") },
    { next: (prefix) => `${prefix}-${++idSequence}` },
    { accessMs: 15 * 60_000, refreshMs: 30 * 86_400_000 },
  );
  return { service };
}

describe("SessionService", () => {
  it("issues short access and longer refresh credentials", async () => {
    const { service } = fixture();
    const session = await service.issue(actor);
    expect(session.accessToken).toBe("token-1");
    expect(session.refreshToken).toBe("token-2");
    expect(await service.authenticateAccess(session.accessToken)).toEqual(actor);
    expect(Date.parse(session.refreshExpiresAt)).toBeGreaterThan(Date.parse(session.accessExpiresAt));
  });

  it("rotates refresh credentials and rejects replay", async () => {
    const { service } = fixture();
    const session = await service.issue(actor);
    const rotated = await service.rotate(session.refreshToken);
    expect(rotated.accessToken).not.toBe(session.accessToken);
    await expect(service.rotate(session.refreshToken)).rejects.toThrow(AuthenticationError);
    await expect(service.authenticateAccess(session.accessToken)).rejects.toThrow(AuthenticationError);
    expect(await service.authenticateAccess(rotated.accessToken)).toEqual(actor);
  });

  it("allows only one winner for concurrent refresh attempts", async () => {
    const { service } = fixture();
    const session = await service.issue(actor);
    const results = await Promise.allSettled([
      service.rotate(session.refreshToken),
      service.rotate(session.refreshToken),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("revokes access and refresh credentials together", async () => {
    const { service } = fixture();
    const session = await service.issue(actor);
    await service.revokeAccess(session.accessToken);
    await expect(service.authenticateAccess(session.accessToken)).rejects.toThrow(SessionRevokedError);
    await expect(service.rotate(session.refreshToken)).rejects.toThrow(SessionRevokedError);
  });
});

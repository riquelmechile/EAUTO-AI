import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  assertAuthorized,
  canAccessAccount,
  hasPermission,
  type ActorIdentity,
} from "@eauto/domain";

const reviewer: ActorIdentity = Object.freeze({
  id: "reviewer-1",
  organizationId: "maustian",
  roles: ["reviewer"],
  accountIds: ["plasticov"],
});

describe("access control", () => {
  it("grants only permissions assigned to the actor roles", () => {
    expect(hasPermission(reviewer, "action.approve")).toBe(true);
    expect(hasPermission(reviewer, "action.execute")).toBe(false);
  });

  it("enforces explicit account scope", () => {
    expect(canAccessAccount(reviewer, "plasticov")).toBe(true);
    expect(canAccessAccount(reviewer, "maustian")).toBe(false);
    expect(() => assertAuthorized(reviewer, "action.approve", "maustian")).toThrow(
      AuthorizationError,
    );
  });

  it("supports owner wildcard scope without weakening permission checks", () => {
    const owner: ActorIdentity = Object.freeze({
      id: "owner-1",
      organizationId: "maustian",
      roles: ["owner"],
      accountIds: ["*"],
    });
    expect(canAccessAccount(owner, "future-account")).toBe(true);
    expect(() => assertAuthorized(owner, "operations.read", "future-account")).not.toThrow();
  });
});

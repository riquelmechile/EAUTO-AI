export const ROLES = ["owner", "admin", "operator", "reviewer", "viewer", "agent"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard.read",
  "inbox.read",
  "content.create",
  "action.propose",
  "action.review",
  "action.approve",
  "action.execute",
  "receipts.read",
  "operations.read",
  "operations.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type ActorIdentity = Readonly<{
  id: string;
  organizationId: string;
  roles: readonly Role[];
  accountIds: readonly string[];
}>;

const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  operator: [
    "dashboard.read",
    "inbox.read",
    "content.create",
    "action.propose",
    "action.review",
    "receipts.read",
  ],
  reviewer: ["dashboard.read", "inbox.read", "action.review", "action.approve", "receipts.read"],
  viewer: ["dashboard.read", "inbox.read", "receipts.read"],
  agent: ["dashboard.read", "content.create", "action.propose", "receipts.read"],
});

export class AuthenticationError extends Error {
  readonly code = "unauthenticated";

  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly code = "forbidden";

  constructor(message = "The actor is not authorized for this operation.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasPermission(actor: ActorIdentity, permission: Permission): boolean {
  return actor.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function canAccessAccount(actor: ActorIdentity, accountId: string): boolean {
  return actor.accountIds.includes("*") || actor.accountIds.includes(accountId);
}

export function assertAuthorized(
  actor: ActorIdentity,
  permission: Permission,
  accountId?: string,
): void {
  if (!hasPermission(actor, permission)) {
    throw new AuthorizationError(`Actor ${actor.id} lacks permission ${permission}.`);
  }
  if (accountId !== undefined && !canAccessAccount(actor, accountId)) {
    throw new AuthorizationError(`Actor ${actor.id} cannot access account ${accountId}.`);
  }
}

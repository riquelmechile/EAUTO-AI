export type AccountId = string & { readonly __brand: "AccountId" };
export type OrganizationId = string & { readonly __brand: "OrganizationId" };

export type CommerceAccount = Readonly<{
  id: AccountId;
  organizationId: OrganizationId;
  name: string;
  channel: "mercadolibre" | "owned-ecommerce" | "social" | "other";
  market: string;
  minimumMarginBps: number;
  autonomyLevel: "ask" | "inform" | "autonomous";
}>;

export function accountId(value: string): AccountId {
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(value)) throw new Error("Invalid account id.");
  return value as AccountId;
}

export function organizationId(value: string): OrganizationId {
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(value)) throw new Error("Invalid organization id.");
  return value as OrganizationId;
}

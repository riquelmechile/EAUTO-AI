import type {
  MercadoLibreConnectionRepository,
  MercadoLibreCredentialRecord,
  MercadoLibreOAuthStateRecord,
  MercadoLibreOAuthStateRepository,
} from "@eauto/application";
import type {
  MercadoLibreClaimSnapshot,
  MercadoLibreListingSnapshot,
  MercadoLibreQuestionSnapshot,
} from "@eauto/domain";

export class InMemoryMercadoLibreOAuthStateRepository implements MercadoLibreOAuthStateRepository {
  private readonly records = new Map<string, MercadoLibreOAuthStateRecord>();

  create(record: MercadoLibreOAuthStateRecord): Promise<void> {
    if (this.records.has(record.stateHash)) {
      throw new Error("MercadoLibre OAuth state already exists.");
    }
    this.records.set(record.stateHash, record);
    return Promise.resolve();
  }

  consume(stateHash: string, now: Date): Promise<MercadoLibreOAuthStateRecord | null> {
    const record = this.records.get(stateHash) ?? null;
    this.records.delete(stateHash);
    if (!record || new Date(record.expiresAt).getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    return Promise.resolve(record);
  }
}

export class InMemoryMercadoLibreConnectionRepository implements MercadoLibreConnectionRepository {
  private readonly records = new Map<string, MercadoLibreCredentialRecord>();
  private readonly listingSnapshots = new Map<string, readonly MercadoLibreListingSnapshot[]>();
  private readonly claimSnapshots = new Map<string, readonly MercadoLibreClaimSnapshot[]>();
  private readonly questionSnapshots = new Map<string, readonly MercadoLibreQuestionSnapshot[]>();

  get(accountId: string): Promise<MercadoLibreCredentialRecord | null> {
    return Promise.resolve(this.records.get(accountId) ?? null);
  }

  save(record: MercadoLibreCredentialRecord): Promise<void> {
    const current = this.records.get(record.connection.accountId);
    if (current !== undefined && current.connection.sellerId !== record.connection.sellerId) {
      throw new Error(
        `MercadoLibre seller binding cannot change for ${record.connection.accountId}.`,
      );
    }
    this.records.set(record.connection.accountId, record);
    return Promise.resolve();
  }

  acquireRefreshLease(input: {
    accountId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<boolean> {
    const record = this.records.get(input.accountId);
    if (!record) return Promise.resolve(false);
    const currentLeaseUntil = record.refreshLeaseUntil
      ? new Date(record.refreshLeaseUntil).getTime()
      : 0;
    if (record.refreshLeaseOwner && currentLeaseUntil > input.now.getTime()) {
      return Promise.resolve(false);
    }
    this.records.set(
      input.accountId,
      Object.freeze({
        ...record,
        refreshLeaseOwner: input.owner,
        refreshLeaseUntil: input.leaseUntil.toISOString(),
      }),
    );
    return Promise.resolve(true);
  }

  releaseRefreshLease(accountId: string, owner: string): Promise<void> {
    const record = this.records.get(accountId);
    if (!record || record.refreshLeaseOwner !== owner) return Promise.resolve();
    this.records.set(
      accountId,
      Object.freeze({
        connection: record.connection,
        protectedAccessToken: record.protectedAccessToken,
        protectedRefreshToken: record.protectedRefreshToken,
        tokenType: record.tokenType,
      }),
    );
    return Promise.resolve();
  }

  markReauthorizationRequired(accountId: string, now: Date): Promise<void> {
    const record = this.records.get(accountId);
    if (!record) return Promise.resolve();
    this.records.set(
      accountId,
      Object.freeze({
        ...record,
        connection: Object.freeze({
          ...record.connection,
          status: "reauthorization-required",
          updatedAt: now.toISOString(),
        }),
      }),
    );
    return Promise.resolve();
  }

  replaceListingSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreListingSnapshot[],
  ): Promise<void> {
    this.listingSnapshots.set(accountId, Object.freeze([...snapshots]));
    return Promise.resolve();
  }

  listListingSnapshots(accountId: string): Promise<readonly MercadoLibreListingSnapshot[]> {
    return Promise.resolve(this.listingSnapshots.get(accountId) ?? []);
  }

  replaceClaimSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreClaimSnapshot[],
  ): Promise<void> {
    this.claimSnapshots.set(accountId, Object.freeze([...snapshots]));
    return Promise.resolve();
  }

  listClaimSnapshots(accountId: string): Promise<readonly MercadoLibreClaimSnapshot[]> {
    return Promise.resolve(this.claimSnapshots.get(accountId) ?? []);
  }

  replaceQuestionSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreQuestionSnapshot[],
  ): Promise<void> {
    this.questionSnapshots.set(accountId, Object.freeze([...snapshots]));
    return Promise.resolve();
  }

  listQuestionSnapshots(accountId: string): Promise<readonly MercadoLibreQuestionSnapshot[]> {
    return Promise.resolve(this.questionSnapshots.get(accountId) ?? []);
  }
}

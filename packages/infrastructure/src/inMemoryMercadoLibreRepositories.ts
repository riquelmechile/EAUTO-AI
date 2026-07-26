import type {
  MercadoLibreConnection,
  MercadoLibreListingSnapshot,
  MercadoLibreOAuthState,
} from "@eauto/domain";
import type {
  MercadoLibreConnectionRepository,
  MercadoLibreListingSnapshotRepository,
  MercadoLibreOAuthStateRepository,
} from "@eauto/application";

export class InMemoryMercadoLibreOAuthStateRepository
  implements MercadoLibreOAuthStateRepository
{
  private readonly states = new Map<string, MercadoLibreOAuthState>();

  save(state: MercadoLibreOAuthState): Promise<void> {
    this.states.set(state.stateHash, state);
    return Promise.resolve();
  }

  consume(stateHash: string, consumedAt: string): Promise<MercadoLibreOAuthState | null> {
    const state = this.states.get(stateHash);
    if (!state || state.consumedAt !== null) return Promise.resolve(null);
    this.states.set(stateHash, Object.freeze({ ...state, consumedAt }));
    return Promise.resolve(state);
  }
}

export class InMemoryMercadoLibreConnectionRepository
  implements MercadoLibreConnectionRepository
{
  private readonly connections = new Map<string, MercadoLibreConnection>();
  private readonly refreshLocks = new Map<string, { workerId: string; lockedUntil: string }>();

  save(connection: MercadoLibreConnection): Promise<void> {
    this.connections.set(connection.accountId, connection);
    this.refreshLocks.delete(connection.accountId);
    return Promise.resolve();
  }

  get(accountId: string): Promise<MercadoLibreConnection | null> {
    return Promise.resolve(this.connections.get(accountId) ?? null);
  }

  claimRefresh(input: {
    accountId: string;
    workerId: string;
    now: string;
    lockedUntil: string;
  }): Promise<boolean> {
    if (!this.connections.has(input.accountId)) return Promise.resolve(false);
    const lock = this.refreshLocks.get(input.accountId);
    if (lock && Date.parse(lock.lockedUntil) > Date.parse(input.now)) return Promise.resolve(false);
    this.refreshLocks.set(input.accountId, {
      workerId: input.workerId,
      lockedUntil: input.lockedUntil,
    });
    return Promise.resolve(true);
  }

  saveRefreshed(input: {
    connection: MercadoLibreConnection;
    workerId: string;
    expectedTokenVersion: number;
  }): Promise<boolean> {
    const current = this.connections.get(input.connection.accountId);
    const lock = this.refreshLocks.get(input.connection.accountId);
    if (
      !current ||
      current.tokenVersion !== input.expectedTokenVersion ||
      lock?.workerId !== input.workerId
    ) {
      return Promise.resolve(false);
    }
    this.connections.set(input.connection.accountId, input.connection);
    this.refreshLocks.delete(input.connection.accountId);
    return Promise.resolve(true);
  }

  releaseRefresh(input: {
    accountId: string;
    workerId: string;
    lastError: string;
  }): Promise<void> {
    const lock = this.refreshLocks.get(input.accountId);
    if (lock?.workerId === input.workerId) this.refreshLocks.delete(input.accountId);
    const connection = this.connections.get(input.accountId);
    if (connection) {
      this.connections.set(
        input.accountId,
        Object.freeze({
          ...connection,
          status: "error",
          lastError: input.lastError,
          updatedAt: new Date().toISOString(),
        }),
      );
    }
    return Promise.resolve();
  }
}

export class InMemoryMercadoLibreListingSnapshotRepository
  implements MercadoLibreListingSnapshotRepository
{
  private readonly snapshots = new Map<string, MercadoLibreListingSnapshot>();

  save(snapshot: MercadoLibreListingSnapshot): Promise<void> {
    this.snapshots.set(snapshot.accountId, snapshot);
    return Promise.resolve();
  }

  get(accountId: string): Promise<MercadoLibreListingSnapshot | null> {
    return Promise.resolve(this.snapshots.get(accountId) ?? null);
  }
}

import type { Approval, BusinessAction, CommerceAccount, ContentAsset } from "@eauto/domain";
import { createReceipt, type VerifiableReceipt } from "@eauto/agent-kernel";
import type {
  AccountRepository,
  ActionRepository,
  ContentAssetRepository,
  LifecycleReceiptDraft,
  OutboxEventDraft,
  OutboxRepository,
  ReceiptRepository,
} from "@eauto/application";
import { InMemoryOutboxRepository } from "./inMemoryOutboxRepository.js";

export class InMemoryAccountRepository implements AccountRepository {
  constructor(private readonly accounts: readonly CommerceAccount[]) {}
  list(): Promise<readonly CommerceAccount[]> {
    return Promise.resolve(this.accounts);
  }
  get(id: string): Promise<CommerceAccount | null> {
    return Promise.resolve(this.accounts.find((account) => account.id === id) ?? null);
  }
}

export class InMemoryActionRepository implements ActionRepository {
  private readonly actions = new Map<string, BusinessAction>();
  private readonly approvals = new Map<string, Approval>();

  constructor(
    private readonly outbox: OutboxRepository = new InMemoryOutboxRepository(),
    private readonly receiptStore: ReceiptRepository = new InMemoryReceiptRepository(),
  ) {}

  async save(
    action: BusinessAction,
    event?: OutboxEventDraft,
    receipt?: LifecycleReceiptDraft,
  ): Promise<void> {
    const current = this.actions.get(action.id);
    if (action.status === "proposed") {
      if (current) throw new Error(`Action ${action.id} already exists.`);
    } else {
      if (!current || current.accountId !== action.accountId) {
        throw new Error(`Action ${action.id} transition conflict.`);
      }
      const allowed: Readonly<Record<string, readonly string[]>> = {
        reviewed: ["proposed"],
        approved: ["reviewed"],
        executing: ["approved"],
        executed: ["executing"],
        verified: ["executed"],
        failed: ["executing", "executed"],
        rejected: ["proposed", "reviewed"],
        expired: ["proposed", "reviewed", "approved"],
      };
      if (!(allowed[action.status] ?? []).includes(current.status)) {
        throw new Error(`Action ${action.id} transition conflict.`);
      }
    }
    this.actions.set(action.id, action);
    if (receipt) await this.appendReceipt(receipt);
    if (event) await this.outbox.enqueue(event);
  }

  get(id: string): Promise<BusinessAction | null> {
    return Promise.resolve(this.actions.get(id) ?? null);
  }

  listPending(accountId: string): Promise<readonly BusinessAction[]> {
    return Promise.resolve(
      [...this.actions.values()].filter(
        (action) =>
          action.accountId === accountId &&
          ["proposed", "reviewed", "approved", "uncertain"].includes(action.status),
      ),
    );
  }

  async saveApproval(
    approval: Approval,
    approvedAction: BusinessAction,
    event?: OutboxEventDraft,
    receipt?: LifecycleReceiptDraft,
  ): Promise<void> {
    if (this.approvals.has(approval.actionId)) {
      throw new Error(`Action ${approval.actionId} already has an approval.`);
    }
    const current = this.actions.get(approvedAction.id);
    if (
      !current ||
      current.accountId !== approvedAction.accountId ||
      current.status !== "reviewed"
    ) {
      throw new Error(`Action ${approvedAction.id} transition conflict.`);
    }
    this.approvals.set(approval.actionId, approval);
    this.actions.set(approvedAction.id, approvedAction);
    if (receipt) await this.appendReceipt(receipt);
    if (event) await this.outbox.enqueue(event);
  }

  getApproval(actionId: string): Promise<Approval | null> {
    return Promise.resolve(this.approvals.get(actionId) ?? null);
  }
  private async appendReceipt(draft: LifecycleReceiptDraft): Promise<void> {
    const chain = await this.receiptStore.listForAction(draft.actionId);
    await this.receiptStore.append(
      createReceipt({
        ...draft,
        previousReceiptHash: chain.at(-1)?.chainHash ?? null,
      }),
    );
  }
}

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly receipts: VerifiableReceipt[] = [];
  append(receipt: VerifiableReceipt): Promise<void> {
    const actionReceipts = this.receipts.filter(
      (candidate) => candidate.actionId === receipt.actionId,
    );
    if (receipt.previousReceiptHash === null) {
      if (actionReceipts.some((candidate) => candidate.previousReceiptHash === null)) {
        throw new Error(`Receipt root already exists for ${receipt.actionId}.`);
      }
    } else if (
      actionReceipts.some(
        (candidate) => candidate.previousReceiptHash === receipt.previousReceiptHash,
      )
    ) {
      throw new Error(`Receipt successor already exists for ${receipt.actionId}.`);
    }
    this.receipts.push(receipt);
    return Promise.resolve();
  }
  listForAction(actionId: string): Promise<readonly VerifiableReceipt[]> {
    return Promise.resolve(this.receipts.filter((receipt) => receipt.actionId === actionId));
  }
}

export class InMemoryContentAssetRepository implements ContentAssetRepository {
  private readonly assets: ContentAsset[] = [];
  save(asset: ContentAsset): Promise<void> {
    this.assets.push(asset);
    return Promise.resolve();
  }
  listForProduct(productId: string): Promise<readonly ContentAsset[]> {
    return Promise.resolve(this.assets.filter((asset) => asset.productId === productId));
  }
}

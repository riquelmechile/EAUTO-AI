import type { Approval, BusinessAction, CommerceAccount, ContentAsset } from "@eauto/domain";
import type { VerifiableReceipt } from "@eauto/agent-kernel";
import type {
  AccountRepository,
  ActionRepository,
  ContentAssetRepository,
  ReceiptRepository,
} from "@eauto/application";

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

  save(action: BusinessAction): Promise<void> {
    this.actions.set(action.id, action);
    return Promise.resolve();
  }
  get(id: string): Promise<BusinessAction | null> {
    return Promise.resolve(this.actions.get(id) ?? null);
  }
  listPending(accountId?: string): Promise<readonly BusinessAction[]> {
    const pending = [...this.actions.values()].filter(
      (action) =>
        ["proposed", "reviewed", "approved"].includes(action.status) &&
        (accountId === undefined || action.accountId === accountId),
    );
    return Promise.resolve(pending);
  }
  saveApproval(approval: Approval): Promise<void> {
    this.approvals.set(approval.actionId, approval);
    return Promise.resolve();
  }
  getApproval(actionId: string): Promise<Approval | null> {
    return Promise.resolve(this.approvals.get(actionId) ?? null);
  }
}

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly receipts: VerifiableReceipt[] = [];
  append(receipt: VerifiableReceipt): Promise<void> {
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

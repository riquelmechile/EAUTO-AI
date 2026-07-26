import type {
  Approval,
  BusinessAction,
  CommerceAccount,
  ContentAsset,
  ProductLaunchBrief,
} from "@eauto/domain";
import type { VerifiableReceipt } from "@eauto/agent-kernel";
import type { OutboxEventDraft } from "./outbox.js";

export type AccountRepository = {
  list(): Promise<readonly CommerceAccount[]>;
  get(id: string): Promise<CommerceAccount | null>;
};

export type ActionRepository = {
  save(action: BusinessAction, event?: OutboxEventDraft): Promise<void>;
  get(id: string): Promise<BusinessAction | null>;
  listPending(accountId?: string): Promise<readonly BusinessAction[]>;
  saveApproval(
    approval: Approval,
    approvedAction: BusinessAction,
    event?: OutboxEventDraft,
  ): Promise<void>;
  getApproval(actionId: string): Promise<Approval | null>;
};

export type ReceiptRepository = {
  append(receipt: VerifiableReceipt): Promise<void>;
  listForAction(actionId: string): Promise<readonly VerifiableReceipt[]>;
};

export type ContentAssetRepository = {
  save(asset: ContentAsset): Promise<void>;
  listForProduct(productId: string): Promise<readonly ContentAsset[]>;
};

export type ContentGenerationPort = {
  generateLaunchAssets(brief: ProductLaunchBrief): Promise<readonly ContentAsset[]>;
};

export type ActionExecutor = {
  execute(action: BusinessAction): Promise<{ providerReceipt: unknown }>;
  verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }>;
};

export type Clock = { now(): Date };
export type IdGenerator = { next(prefix: string): string };

export type ContentChannel = "mercadolibre" | "instagram" | "facebook" | "tiktok" | "owned";
export type AssetKind = "source-image" | "image" | "video" | "copy";

export type ContentAsset = Readonly<{
  id: string;
  accountId: string;
  productId: string;
  kind: AssetKind;
  uri: string;
  contentHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: string;
}>;

export type ProductLaunchBrief = Readonly<{
  id: string;
  accountId: string;
  sourceImageUri: string;
  knownCostMinor?: number;
  stock?: number;
  instructions?: string;
  requestedChannels: readonly ContentChannel[];
}>;

export type MercadoLibreItemDraftAttribute = Readonly<{
  id: string;
  valueId: string | null;
  valueName: string | null;
}>;

export type MercadoLibreItemDraftPicture = Readonly<{
  source: string;
}>;

export type MercadoLibreItemValidationDraft = Readonly<{
  title: string;
  categoryId: string;
  priceMinor: number;
  currencyId: "CLP";
  availableQuantity: number;
  buyingMode: "buy_it_now";
  listingTypeId: string;
  attributes: readonly MercadoLibreItemDraftAttribute[];
  saleTerms: readonly MercadoLibreItemDraftAttribute[];
  pictures: readonly MercadoLibreItemDraftPicture[];
  shipping: Readonly<{
    mode: "me2";
    localPickup: boolean;
    freeShipping: boolean;
  }>;
}>;

export type MercadoLibreItemValidationCause = Readonly<{
  department: string | null;
  causeId: string | null;
  type: string;
  code: string;
  references: readonly string[];
  message: string;
}>;

export type MercadoLibreRemoteItemValidationResult = Readonly<{
  status: "valid" | "invalid";
  causes: readonly MercadoLibreItemValidationCause[];
  sourceHash: string;
}>;

export type MercadoLibreItemValidationResult = MercadoLibreRemoteItemValidationResult &
  Readonly<{
    sellerId: string;
    observedAt: string;
  }>;

export interface MercadoLibreItemValidationClientPort {
  validateItemDraft(
    draft: MercadoLibreItemValidationDraft,
    accessToken: string,
  ): Promise<MercadoLibreRemoteItemValidationResult>;
}

import {
  UploadValidationError,
  sourceImageExtension,
  validateSourceImageUploadRequest,
  type SourceImageUpload,
  type UploadSourceImageRequest,
} from "@eauto/domain";
import type { Clock } from "./ports.js";

export type SourceImageUploadRepository = {
  save(upload: SourceImageUpload): Promise<void>;
  get(id: string): Promise<SourceImageUpload | null>;
};

export type ObjectStoragePort = {
  createPresignedUpload(input: {
    objectKey: string;
    contentType: string;
    checksumSha256Base64: string;
    expiresInSeconds: number;
  }): Promise<Readonly<{ uploadUrl: string; requiredHeaders: Readonly<Record<string, string>> }>>;
  inspectObject(objectKey: string): Promise<
    Readonly<{
      exists: boolean;
      sizeBytes: number | null;
      contentType: string | null;
      checksumSha256Base64: string | null;
      objectUri: string;
    }>
  >;
};

export type RequestedSourceImageUpload = Readonly<{
  upload: SourceImageUpload;
  uploadUrl: string;
  requiredHeaders: Readonly<Record<string, string>>;
}>;

export class SourceImageUploadService {
  constructor(
    private readonly uploads: SourceImageUploadRepository,
    private readonly storage: ObjectStoragePort,
    private readonly clock: Clock,
    private readonly policy: Readonly<{
      maximumBytes: number;
      uploadExpiresInSeconds: number;
    }>,
  ) {}

  async requestUpload(request: UploadSourceImageRequest): Promise<RequestedSourceImageUpload> {
    validateSourceImageUploadRequest(request, this.policy.maximumBytes);
    const now = this.clock.now();
    const objectKey = [
      "organizations",
      encodeSegment(request.organizationId),
      "accounts",
      encodeSegment(request.accountId),
      "source-images",
      `${encodeSegment(request.id)}.${sourceImageExtension(request.contentType)}`,
    ].join("/");
    const upload: SourceImageUpload = Object.freeze({
      id: request.id,
      organizationId: request.organizationId,
      accountId: request.accountId,
      objectKey,
      originalFileName: request.originalFileName,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      checksumSha256Base64: request.checksumSha256Base64,
      status: "requested",
      objectUri: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.policy.uploadExpiresInSeconds * 1_000).toISOString(),
      verifiedAt: null,
      rejectionReason: null,
    });
    await this.uploads.save(upload);
    const signed = await this.storage.createPresignedUpload({
      objectKey,
      contentType: upload.contentType,
      checksumSha256Base64: upload.checksumSha256Base64,
      expiresInSeconds: this.policy.uploadExpiresInSeconds,
    });
    return Object.freeze({ upload, ...signed });
  }

  async verifyUpload(
    id: string,
    organizationId: string,
    accountId: string,
  ): Promise<SourceImageUpload> {
    const upload = await this.requireOwnedUpload(id, organizationId, accountId);
    if (upload.status === "verified") return upload;
    const now = this.clock.now();
    if (Date.parse(upload.expiresAt) <= now.getTime()) {
      const expired = Object.freeze({
        ...upload,
        status: "expired" as const,
        rejectionReason: "Upload verification window expired.",
      });
      await this.uploads.save(expired);
      throw new UploadValidationError("Upload verification window expired.");
    }

    const observed = await this.storage.inspectObject(upload.objectKey);
    const mismatch = verifyObservedObject(upload, observed);
    if (mismatch) {
      const rejected = Object.freeze({
        ...upload,
        status: "rejected" as const,
        rejectionReason: mismatch,
      });
      await this.uploads.save(rejected);
      throw new UploadValidationError(mismatch);
    }

    const verified = Object.freeze({
      ...upload,
      status: "verified" as const,
      objectUri: observed.objectUri,
      verifiedAt: now.toISOString(),
      rejectionReason: null,
    });
    await this.uploads.save(verified);
    return verified;
  }

  async requireVerified(
    id: string,
    organizationId: string,
    accountId: string,
  ): Promise<SourceImageUpload> {
    const upload = await this.requireOwnedUpload(id, organizationId, accountId);
    if (upload.status !== "verified" || upload.objectUri === null) {
      throw new UploadValidationError("A verified source image for this account is required.");
    }
    return upload;
  }

  private async requireOwnedUpload(
    id: string,
    organizationId: string,
    accountId: string,
  ): Promise<SourceImageUpload> {
    const upload = await this.uploads.get(id);
    if (!upload || upload.organizationId !== organizationId || upload.accountId !== accountId) {
      throw new UploadValidationError(`Upload ${id} was not found.`);
    }
    return upload;
  }
}

function verifyObservedObject(
  expected: SourceImageUpload,
  observed: Awaited<ReturnType<ObjectStoragePort["inspectObject"]>>,
): string | null {
  if (!observed.exists) return "Uploaded object was not found.";
  if (observed.sizeBytes !== expected.sizeBytes)
    return "Uploaded object size does not match the request.";
  if (observed.contentType !== expected.contentType)
    return "Uploaded object content type does not match.";
  if (observed.checksumSha256Base64 !== expected.checksumSha256Base64) {
    return "Uploaded object checksum does not match.";
  }
  return null;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

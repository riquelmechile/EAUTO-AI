import {
  isVerifiedSourceImageUpload,
  type SourceImageUpload,
  type VerifiedSourceImageUpload,
} from "@eauto/domain";
import type {
  ForReadingVerifiedSourceImages,
  SourceImageUploadRepository,
} from "@eauto/application";

export class InMemorySourceImageUploadRepository
  implements SourceImageUploadRepository, ForReadingVerifiedSourceImages
{
  private readonly uploads = new Map<string, SourceImageUpload>();

  save(upload: SourceImageUpload): Promise<void> {
    const existing = this.uploads.get(upload.id);
    if (!existing) {
      if (upload.status !== "requested") {
        throw new Error(`Upload ${upload.id} must be created in requested state.`);
      }
      this.uploads.set(upload.id, upload);
      return Promise.resolve();
    }
    if (
      existing.organizationId !== upload.organizationId ||
      existing.accountId !== upload.accountId ||
      existing.objectKey !== upload.objectKey
    ) {
      throw new Error(`Upload ${upload.id} ownership is immutable.`);
    }
    if (upload.status === "requested") {
      if (JSON.stringify(existing) !== JSON.stringify(upload)) {
        throw new Error(`Upload ${upload.id} already exists with different content.`);
      }
      return Promise.resolve();
    }
    if (existing.status !== "requested") {
      throw new Error(`Upload ${upload.id} transition conflict.`);
    }
    this.uploads.set(upload.id, upload);
    return Promise.resolve();
  }

  get(input: {
    id: string;
    organizationId: string;
    accountId: string;
  }): Promise<SourceImageUpload | null> {
    const upload = this.uploads.get(input.id);
    if (
      !upload ||
      upload.organizationId !== input.organizationId ||
      upload.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(upload);
  }

  async getVerified(input: {
    organizationId: string;
    accountId: string;
    sourceImageUploadId: string;
  }): Promise<VerifiedSourceImageUpload | null> {
    const upload = await this.get({
      id: input.sourceImageUploadId,
      organizationId: input.organizationId,
      accountId: input.accountId,
    });
    return upload && isVerifiedSourceImageUpload(upload) ? upload : null;
  }
}

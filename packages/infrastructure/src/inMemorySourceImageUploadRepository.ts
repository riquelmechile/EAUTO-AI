import type { SourceImageUpload } from "@eauto/domain";
import type { SourceImageUploadRepository } from "@eauto/application";

export class InMemorySourceImageUploadRepository implements SourceImageUploadRepository {
  private readonly uploads = new Map<string, SourceImageUpload>();

  save(upload: SourceImageUpload): Promise<void> {
    this.uploads.set(upload.id, upload);
    return Promise.resolve();
  }

  get(id: string): Promise<SourceImageUpload | null> {
    return Promise.resolve(this.uploads.get(id) ?? null);
  }
}

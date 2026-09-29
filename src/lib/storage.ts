export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';

export type UploadPurpose = 'lecture-material' | 'payment-receipt' | 'flashcard-image';

export function objectKey(purpose: UploadPurpose, ownerId: string, filename: string): string {
  const safe = safeFilename(filename);
  const id = crypto.randomUUID();
  switch (purpose) {
    case 'lecture-material': return `lecture-materials/${ownerId}/${id}-${safe}`;
    case 'flashcard-image': return `flashcards/${ownerId}/${id}-${safe}`;
    case 'payment-receipt': return `payment-receipts/${ownerId}/${id}-${safe}`;
  }
}

/** R2 accepts up to 1,000 keys per delete call. Empty input is a no-op. */
export async function deletePrivateObjects(bucket: R2Bucket, keys: Iterable<string | null | undefined>): Promise<void> {
  const uniqueKeys = [...new Set([...keys].filter((key): key is string => !!key))];
  for (let offset = 0; offset < uniqueKeys.length; offset += 1_000) {
    await bucket.delete(uniqueKeys.slice(offset, offset + 1_000));
  }
}

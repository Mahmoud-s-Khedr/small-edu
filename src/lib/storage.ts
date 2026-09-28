import { badRequest } from './errors';

const MAX_BYTES = 100 * 1024 * 1024;
const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';

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

export async function putPrivateObject(
  bucket: R2Bucket,
  request: Request,
  purpose: UploadPurpose,
  ownerId: string,
): Promise<{ objectKey: string; filename: string; contentType: string; sizeBytes: number }> {
  const filename = request.headers.get('X-Filename');
  const contentLength = request.headers.get('Content-Length');
  const length = contentLength === null ? Number.NaN : Number(contentLength);
  const contentType = request.headers.get('Content-Type')?.split(';')[0] ?? 'application/octet-stream';
  if (!filename || !request.body) throw badRequest('A raw file body and X-Filename header are required');
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES) throw badRequest('A valid Content-Length of 100 MB or smaller is required');
  if (purpose === 'payment-receipt' && !['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) {
    throw badRequest('Payment receipts must be PDF, JPEG, or PNG');
  }
  if (purpose === 'flashcard-image' && !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw badRequest('Flashcard images must be JPEG, PNG, or WebP');
  }
  const key = objectKey(purpose, ownerId, filename);
  // R2 only accepts streams with a known length. The fixed-length stream also
  // rejects a body that is larger or smaller than the declared, already-capped
  // Content-Length, so a forged header cannot bypass the size limit.
  const body = new FixedLengthStream(length);
  const [stored] = await Promise.all([
    bucket.put(key, body.readable, { httpMetadata: { contentType } }),
    request.body.pipeTo(body.writable),
  ]);
  if (!stored) throw new Error('R2 upload precondition failed');
  return { objectKey: key, filename: safeFilename(filename), contentType, sizeBytes: stored.size };
}

/** R2 accepts up to 1,000 keys per delete call. Empty input is a no-op. */
export async function deletePrivateObjects(bucket: R2Bucket, keys: Iterable<string | null | undefined>): Promise<void> {
  const uniqueKeys = [...new Set([...keys].filter((key): key is string => !!key))];
  for (let offset = 0; offset < uniqueKeys.length; offset += 1_000) {
    await bucket.delete(uniqueKeys.slice(offset, offset + 1_000));
  }
}

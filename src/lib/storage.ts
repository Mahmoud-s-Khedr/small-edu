import { badRequest } from './errors';

const MAX_BYTES = 10 * 1024 * 1024;
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
  const length = Number(request.headers.get('Content-Length') ?? 0);
  const contentType = request.headers.get('Content-Type')?.split(';')[0] ?? 'application/octet-stream';
  if (!filename || !request.body) throw badRequest('A raw file body and X-Filename header are required');
  if (!Number.isFinite(length) || length < 0 || length > MAX_BYTES) throw badRequest('File must be 10 MB or smaller');
  if (purpose === 'payment-receipt' && !['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) {
    throw badRequest('Payment receipts must be PDF, JPEG, or PNG');
  }
  if (purpose === 'flashcard-image' && !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw badRequest('Flashcard images must be JPEG, PNG, or WebP');
  }
  const key = objectKey(purpose, ownerId, filename);
  const stored = await bucket.put(key, request.body, { httpMetadata: { contentType } });
  if (!stored) throw new Error('R2 upload precondition failed');
  return { objectKey: key, filename: safeFilename(filename), contentType, sizeBytes: stored.size };
}

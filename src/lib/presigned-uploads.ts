import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import { badRequest, serviceUnavailable } from './errors';
import { MAX_UPLOAD_BYTES, objectKey, safeFilename, type UploadPurpose } from './storage';

const URL_TTL_SECONDS = 10 * 60;

export const uploadDetails = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export type UploadDetails = z.infer<typeof uploadDetails>;

export function validateUploadDetails(purpose: UploadPurpose, details: UploadDetails): void {
  if (purpose === 'payment-receipt' && !['application/pdf', 'image/jpeg', 'image/png'].includes(details.contentType)) {
    throw badRequest('Payment receipts must be PDF, JPEG, or PNG');
  }
  if (purpose === 'flashcard-image' && !['image/jpeg', 'image/png', 'image/webp'].includes(details.contentType)) {
    throw badRequest('Flashcard images must be JPEG, PNG, or WebP');
  }
}

/** Creates a capability limited to one private R2 PUT. */
export async function createPresignedUpload(
  env: Env,
  purpose: UploadPurpose,
  ownerId: string,
  details: UploadDetails,
): Promise<{ objectKey: string; filename: string; contentType: string; sizeBytes: number; uploadUrl: string; expiresAt: string; requiredHeaders: { 'Content-Type': string } }> {
  validateUploadDetails(purpose, details);
  if (!env.R2_ACCOUNT_ID || !env.R2_S3_ACCESS_KEY_ID || !env.R2_S3_SECRET_ACCESS_KEY) {
    throw serviceUnavailable('Direct uploads are not configured');
  }
  const key = objectKey(purpose, ownerId, details.filename);
  const endpoint = new URL(`https://${env.R2_BUCKET_NAME ?? 'medly-storage'}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key.split('/').map(encodeURIComponent).join('/')}`);
  endpoint.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS));
  const client = new AwsClient({
    accessKeyId: env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const signed = await client.sign(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': details.contentType },
    aws: { signQuery: true, service: 's3', region: 'auto' },
  });
  const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1_000).toISOString();
  return {
    objectKey: key,
    filename: safeFilename(details.filename),
    contentType: details.contentType,
    sizeBytes: details.sizeBytes,
    uploadUrl: signed.url,
    expiresAt,
    requiredHeaders: { 'Content-Type': details.contentType },
  };
}

/** Creates a short-lived capability to download one private R2 object. */
export async function createPresignedDownload(env: Env, key: string): Promise<string> {
  if (!env.R2_ACCOUNT_ID || !env.R2_S3_ACCESS_KEY_ID || !env.R2_S3_SECRET_ACCESS_KEY) {
    throw serviceUnavailable('Direct downloads are not configured');
  }
  const endpoint = new URL(`https://${env.R2_BUCKET_NAME ?? 'medly-storage'}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key.split('/').map(encodeURIComponent).join('/')}`);
  endpoint.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS));
  const client = new AwsClient({
    accessKeyId: env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const signed = await client.sign(endpoint, {
    method: 'GET',
    aws: { signQuery: true, service: 's3', region: 'auto' },
  });
  return signed.url;
}

/** Verifies a direct upload before it can become application data. */
export async function verifyDirectUpload(bucket: R2Bucket, key: string, details: UploadDetails): Promise<void> {
  const object = await bucket.head(key);
  if (!object) throw badRequest('Upload has not completed');
  if (object.size !== details.sizeBytes || object.httpMetadata?.contentType !== details.contentType) {
    throw badRequest('Uploaded file does not match the authorized size and content type');
  }
}

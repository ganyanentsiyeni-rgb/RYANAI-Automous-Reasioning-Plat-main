import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const STUDIO_ARTIFACT_BUCKET = 'ryanai-studio-artifacts';
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required for Studio artifact storage.');
  return value;
}

let storageClient: SupabaseClient | null = null;
function storage(): SupabaseClient {
  if (!storageClient) {
    storageClient = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return storageClient;
}

export interface StoredStudioArtifact {
  storageKey: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
}

export async function storeStudioArtifact(input: {
  ownerUserId: string;
  projectId: string;
  taskId: string;
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  idempotencyKey?: string;
}): Promise<StoredStudioArtifact> {
  if (!input.ownerUserId || !input.projectId || !input.taskId) throw new Error('Owner, project and task scope are required.');
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('Studio artifact size is outside the permitted limit.');
  }
  if (!['application/json', 'text/plain', 'text/markdown'].includes(input.mimeType)) {
    throw new Error('Studio artifact MIME type is not permitted by the native worker.');
  }
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'artifact.json';
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const idempotencyDigest = input.idempotencyKey
    ? createHash('sha256').update(input.idempotencyKey).digest('hex')
    : randomUUID();
  const storageKey = [
    input.ownerUserId,
    input.projectId,
    input.taskId,
    idempotencyDigest,
    sha256 + '-' + safeName,
  ].join('/');
  const { error } = await storage().storage.from(STUDIO_ARTIFACT_BUCKET).upload(storageKey, Buffer.from(input.bytes), {
    contentType: input.mimeType,
    cacheControl: '0',
    // The content digest is part of the deterministic path, so retries can
    // safely reuse the exact same object without overwriting different bytes.
    upsert: Boolean(input.idempotencyKey),
  });
  if (error) throw new Error('Studio artifact upload failed: ' + error.message);
  return { storageKey, sha256, byteSize: input.bytes.byteLength, mimeType: input.mimeType };
}

export async function removeStoredStudioArtifact(storageKey: string) {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..')) throw new Error('Invalid Studio artifact storage key.');
  const { error } = await storage().storage.from(STUDIO_ARTIFACT_BUCKET).remove([storageKey]);
  if (error) throw new Error('Studio artifact cleanup failed: ' + error.message);
}

/** Creates a short-lived URL only after the caller has verified owner-scoped metadata. */
export async function createStudioArtifactDownloadUrl(storageKey: string, expiresInSeconds = 120) {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..')) throw new Error('Invalid Studio artifact storage key.');
  const ttl = Math.max(30, Math.min(300, Math.trunc(expiresInSeconds)));
  const { data, error } = await storage().storage.from(STUDIO_ARTIFACT_BUCKET).createSignedUrl(storageKey, ttl, { download: true });
  if (error || !data?.signedUrl) throw new Error('Studio artifact download URL could not be created.');
  return { signedUrl: data.signedUrl, expiresInSeconds: ttl };
}

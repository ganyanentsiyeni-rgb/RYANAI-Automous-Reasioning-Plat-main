import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveConnectionUrls } from '../server/startupConfig.js';

function resolvedSourceDatabaseUrl(): string {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is not configured.');
  }
  const { databaseUrl } = resolveConnectionUrls(
    process.env.NODE_ENV || 'development',
    process.env.DATABASE_URL,
    process.env.REDIS_URL,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SESSION_POOLER_HOST,
    process.env.SUPABASE_SSL_ROOT_CERT_PATH,
    process.env.RYANAI_LOCAL_COMPOSE === 'true',
    process.env.RYANAI_DISPOSABLE_SUPABASE === '1',
  );
  return databaseUrl;
}

export type BackupStatus = 'ready' | 'not_configured' | 'unavailable';

export interface BackupPreflight {
  status: BackupStatus;
  databaseConfigured: boolean;
  storageConfigured: boolean;
  privateDestinationVerified: boolean;
  destinationBucket: string | null;
  sourceBuckets: string[];
  pgDumpAvailable: boolean;
  reason?: string;
}

export interface BackupResult {
  status: 'succeeded' | 'failed' | 'not_configured';
  backupId?: string;
  prefix?: string;
  databaseBytes?: number;
  databaseSha256?: string;
  reason?: string;
}

function storageConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  const bucket = process.env.SUPABASE_BACKUP_BUCKET?.trim();
  if (!url || !key || !bucket) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;
    return { baseUrl: parsed.origin, key, bucket };
  } catch {
    return null;
  }
}

async function privateBucketAvailable(storage: NonNullable<ReturnType<typeof storageConfig>>): Promise<boolean> {
  try {
    const response = await storageRequest(storage.baseUrl, storage.key, '/storage/v1/bucket/' + encodeURIComponent(storage.bucket));
    const bucket = await response.json() as { public?: unknown };
    return bucket.public === false;
  } catch { return false; }
}

function pgDumpAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pg_dump', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

async function storageRequest(baseUrl: string, key: string, pathName: string, init: RequestInit = {}) {
  const response = await fetch(baseUrl + pathName, {
    ...init,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error('Supabase Storage returned HTTP ' + response.status + '.');
  }
  return response;
}

export async function backupPreflight(): Promise<BackupPreflight> {
  const storage = storageConfig();
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const dumpAvailable = await pgDumpAvailable();
  if (!databaseConfigured || !storage) {
    return {
      status: 'not_configured',
      databaseConfigured,
      storageConfigured: Boolean(storage),
      privateDestinationVerified: false,
      destinationBucket: storage?.bucket ?? null,
      sourceBuckets: [],
      pgDumpAvailable: dumpAvailable,
      reason: 'DATABASE_URL and a private SUPABASE_BACKUP_BUCKET-backed storage configuration are required.',
    };
  }
  if (!dumpAvailable) {
    return {
      status: 'unavailable',
      databaseConfigured: true,
      storageConfigured: true,
      privateDestinationVerified: false,
      destinationBucket: storage.bucket,
      sourceBuckets: [],
      pgDumpAvailable: false,
      reason: 'pg_dump is not installed in this runtime image.',
    };
  }
  const privateDestinationVerified = await privateBucketAvailable(storage);
  const sourceBuckets = (process.env.RYANAI_BACKUP_STORAGE_BUCKETS || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!privateDestinationVerified || sourceBuckets.includes(storage.bucket)) {
    return {
      status: 'unavailable', databaseConfigured: true, storageConfigured: true,
      privateDestinationVerified, destinationBucket: storage.bucket, sourceBuckets, pgDumpAvailable: true,
      reason: !privateDestinationVerified ? 'Backup destination bucket privacy or reachability could not be verified.' : 'Backup destination must be separate from configured source buckets.',
    };
  }
  return {
    status: 'ready', databaseConfigured: true, storageConfigured: true, privateDestinationVerified: true,
    destinationBucket: storage.bucket, sourceBuckets, pgDumpAvailable: true,
  };
}

function pgDump(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let databaseUrl: string;
    try {
      databaseUrl = resolvedSourceDatabaseUrl();
    } catch {
      reject(new Error('Database connection configuration could not be resolved safely.'));
      return;
    }
    const child = spawn('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file',
      file,
      databaseUrl,
    ], {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: process.env,
    });
    child.once('error', () => reject(new Error('pg_dump could not be started.')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('pg_dump failed with exit code ' + String(code) + '.')));
  });
}

export interface BackupInventoryItem {
  backupId: string;
  prefix: string;
  createdAt: string | null;
  databaseBytes: number | null;
  databaseSha256: string | null;
  /** Inventory reads the manifest only; the stored dump has not been re-downloaded and re-hashed. */
  integrityStatus: 'not_verified';
  manifestPresent: boolean;
  retention: 'within_policy' | 'outside_policy' | 'unknown';
}

export interface BackupInventory {
  status: 'available' | 'not_configured' | 'unavailable';
  bucket: string | null;
  retentionDays: number;
  listedAt: string;
  items: BackupInventoryItem[];
  hasMore: boolean;
  reason?: string;
}

function retentionWindowDays(): number {
  const parsed = Number.parseInt(process.env.RYANAI_BACKUP_RETENTION_DAYS || '30', 10);
  return Number.isFinite(parsed) && parsed >= 7 && parsed <= 3650 ? parsed : 30;
}

interface StorageObject {
  name?: string;
  id?: string | null;
  created_at?: string;
  updated_at?: string;
  metadata?: { size?: number } | null;
}

async function listStorageObjects(
  storage: NonNullable<ReturnType<typeof storageConfig>>,
  prefix: string,
): Promise<StorageObject[]> {
  const response = await storageRequest(
    storage.baseUrl,
    storage.key,
    '/storage/v1/object/list/' + encodeURIComponent(storage.bucket),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' },
      }),
    },
  );
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Supabase Storage returned an invalid object listing.');
  }
  return payload as StorageObject[];
}

export async function listDatabaseBackups(): Promise<BackupInventory> {
  const storage = storageConfig();
  const retentionDays = retentionWindowDays();
  const listedAt = new Date().toISOString();
  if (!storage) {
    return {
      status: 'not_configured',
      bucket: null,
      retentionDays,
      listedAt,
      items: [],
      hasMore: false,
      reason: 'Private backup storage is not configured.',
    };
  }

  try {
    const folders = await listStorageObjects(storage, 'ryanai-admin');
    const folderNames = folders
      .filter((entry) => !entry.id && entry.name)
      .map((entry) => entry.name as string)
      .filter((name) => name !== '.' && name !== '..')
      .slice(0, 100);
    const now = Date.now();
    const items: BackupInventoryItem[] = [];

    for (const folder of folderNames) {
      const prefix = 'ryanai-admin/' + folder;
      const objects = await listStorageObjects(storage, prefix);
      const dump = objects.find((entry) => entry.name === 'database.dump');
      const manifestObject = objects.find((entry) => entry.name === 'manifest.json');
      type BackupManifest = {
        backupId?: string;
        createdAt?: string;
        databaseDump?: { bytes?: number; sha256?: string };
      };
      let manifest: BackupManifest | null = null;

      if (manifestObject) {
        try {
          const response = await storageRequest(
            storage.baseUrl,
            storage.key,
            '/storage/v1/object/' + encodeURIComponent(storage.bucket) + '/' + prefix.split('/').map(encodeURIComponent).join('/') + '/manifest.json',
          );
          manifest = await response.json() as BackupManifest;
        } catch {
          manifest = null;
        }
      }

      const createdAt = manifest?.createdAt || dump?.created_at || manifestObject?.created_at || null;
      const age = createdAt ? now - Date.parse(createdAt) : Number.NaN;
      const retention = Number.isFinite(age)
        ? age > retentionDays * 24 * 60 * 60 * 1000 ? 'outside_policy' : 'within_policy'
        : 'unknown';
      items.push({
        backupId: manifest?.backupId || folder,
        prefix,
        createdAt,
        databaseBytes: manifest?.databaseDump?.bytes ?? dump?.metadata?.size ?? null,
        databaseSha256: manifest?.databaseDump?.sha256 ?? null,
        integrityStatus: 'not_verified',
        manifestPresent: Boolean(manifestObject && manifest),
        retention,
      });
    }

    return {
      status: 'available',
      bucket: storage.bucket,
      retentionDays,
      listedAt,
      items: items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
      hasMore: folders.length > 100,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      bucket: storage.bucket,
      retentionDays,
      listedAt,
      items: [],
      hasMore: false,
      reason: error instanceof Error ? error.message : 'Backup inventory could not be listed.',
    };
  }
}

export interface BackupArtifactVerification { backupId: string; status: 'verified' | 'failed' | 'not_verified'; bytesRehashed: boolean; actualBytes: number | null; reason?: string; }
const MAX_RECOVERY_VERIFY_ARTIFACTS = 10;
const MAX_RECOVERY_VERIFY_BYTES = 256 * 1024 * 1024;
/** Read-only, bounded re-download and SHA-256 verification of private dump objects. */
export async function verifyDatabaseBackupArtifacts(inventory: BackupInventory, request: typeof storageRequest = storageRequest): Promise<BackupArtifactVerification[]> {
 const storage = storageConfig();
 if (!storage || inventory.status !== 'available') return inventory.items.map(item => ({ backupId:item.backupId,status:'not_verified',bytesRehashed:false,actualBytes:null,reason:'Private backup storage or inventory is unavailable.' }));
 return Promise.all(inventory.items.slice(0,MAX_RECOVERY_VERIFY_ARTIFACTS).map(async item => {
  if (!item.manifestPresent || !item.databaseSha256 || !/^[a-f0-9]{64}$/i.test(item.databaseSha256) || !Number.isSafeInteger(item.databaseBytes) || (item.databaseBytes ?? 0)<=0 || (item.databaseBytes ?? 0)>MAX_RECOVERY_VERIFY_BYTES)
   return {backupId:item.backupId,status:'not_verified' as const,bytesRehashed:false,actualBytes:null,reason:'Manifest, SHA-256, or bounded artifact size evidence is missing or invalid.'};
  try {
   const objectPath=item.prefix.split('/').map(encodeURIComponent).join('/');
   const response=await request(storage.baseUrl,storage.key,'/storage/v1/object/authenticated/'+encodeURIComponent(storage.bucket)+'/'+objectPath+'/database.dump');
   const declared=Number(response.headers.get('content-length'));
   if(Number.isFinite(declared)&&declared>MAX_RECOVERY_VERIFY_BYTES) return {backupId:item.backupId,status:'failed' as const,bytesRehashed:false,actualBytes:null,reason:'Stored artifact exceeds the verification size limit.'};
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.byteLength>MAX_RECOVERY_VERIFY_BYTES) return {backupId:item.backupId,status:'failed' as const,bytesRehashed:false,actualBytes:bytes.byteLength,reason:'Stored artifact exceeds the verification size limit.'};
   const digest=createHash('sha256').update(bytes).digest('hex'), matches=bytes.byteLength===item.databaseBytes&&digest===item.databaseSha256.toLowerCase();
   return {backupId:item.backupId,status:matches?'verified' as const:'failed' as const,bytesRehashed:true,actualBytes:bytes.byteLength,...(matches?{}:{reason:'Stored artifact byte count or SHA-256 does not match its manifest.'})};
  } catch { return {backupId:item.backupId,status:'failed' as const,bytesRehashed:false,actualBytes:null,reason:'Stored artifact could not be downloaded for verification.'}; }
 }));
}
\nexport function backupReadbackMatches(original: Uint8Array, stored: Uint8Array): boolean {
  if (original.byteLength !== stored.byteLength) return false;
  const originalDigest = createHash('sha256').update(original).digest('hex');
  const storedDigest = createHash('sha256').update(stored).digest('hex');
  return originalDigest === storedDigest;
}

export interface BackupArtifactStorage {
  baseUrl: string;
  key: string;
  bucket: string;
}

export async function persistBackupArtifact(
  storage: BackupArtifactStorage,
  prefix: string,
  dump: Buffer,
  manifest: Record<string, unknown>,
  request: typeof storageRequest = storageRequest,
): Promise<void> {
  const objectPrefix = prefix.split('/').map(encodeURIComponent).join('/');
  await request(storage.baseUrl, storage.key, '/storage/v1/object/' + encodeURIComponent(storage.bucket) + '/' + objectPrefix + '/database.dump', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
      'x-client-info': 'ryanai-admin-resilience',
    },
    body: dump,
  });

  const verification = await request(
    storage.baseUrl,
    storage.key,
    '/storage/v1/object/authenticated/' + encodeURIComponent(storage.bucket) + '/' + objectPrefix + '/database.dump',
  );
  const storedDump = Buffer.from(await verification.arrayBuffer());
  if (!backupReadbackMatches(dump, storedDump)) {
    throw new Error('Uploaded backup failed read-back size or SHA-256 integrity verification.');
  }

  await request(storage.baseUrl, storage.key, '/storage/v1/object/' + encodeURIComponent(storage.bucket) + '/' + objectPrefix + '/manifest.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(manifest, null, 2),
  });
}

export async function createDatabaseBackup(): Promise<BackupResult> {
  const preflight = await backupPreflight();
  if (preflight.status !== 'ready') return { status: preflight.status === 'not_configured' ? 'not_configured' : 'failed', reason: preflight.reason };

  const storage = storageConfig();
  if (!storage) return { status: 'not_configured', reason: 'Backup storage configuration is incomplete.' };

  const backupId = randomUUID();
  const prefix = 'ryanai-admin/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + backupId;
  const temp = await mkdtemp(path.join(tmpdir(), 'ryanai-admin-backup-'));
  try {
    const dumpPath = path.join(temp, 'database.dump');
    await pgDump(dumpPath);
    const dump = await readFile(dumpPath);
    const sha256 = createHash('sha256').update(dump).digest('hex');
    const manifest = {
      format: 'ryanai-admin-backup-v1',
      backupId,
      createdAt: new Date().toISOString(),
      gitCommit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null,
      databaseDump: { object: 'database.dump', bytes: dump.length, sha256 },
      secretsIncluded: false,
      recoveryTargetRequired: true,
    };
    await persistBackupArtifact(storage, prefix, dump, manifest);

    return { status: 'succeeded', backupId, prefix, databaseBytes: dump.length, databaseSha256: sha256 };
  } catch (error) {
    return { status: 'failed', backupId, prefix, reason: error instanceof Error ? error.message : 'Backup failed.' };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}


/**
 * Returns migration directory names shipped with this application build.
 * This is repository inventory only; it is not evidence that a database applied them.
 */
export async function listExpectedMigrationIds(): Promise<{ status: 'available' | 'unavailable'; migrationIds: string[]; reason?: string }> {
  try {
    const entries = await readdir(path.resolve(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true });
    const migrationIds = entries
      .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    return { status: 'available', migrationIds };
  } catch {
    return { status: 'unavailable', migrationIds: [], reason: 'Repository migration inventory could not be read.' };
  }
}

export interface RecoveryPreflight {
  status: 'not_configured' | 'invalid_target' | 'blocked_same_as_source' | 'identity_unverified';
  targetLabel: string | null;
  productionRestore: 'disabled';
  writesPerformed: false;
  reason?: string;
}

export function recoveryPreflight(): RecoveryPreflight {
  const target = process.env.RYANAI_RECOVERY_DATABASE_URL?.trim();
  const targetLabel = process.env.RYANAI_RECOVERY_TARGET_LABEL?.trim() || null;
  if (!target || !targetLabel) {
    return {
      status: 'not_configured',
      targetLabel,
      productionRestore: 'disabled',
      writesPerformed: false,
      reason: 'A separately labelled recovery database target is required.',
    };
  }

  try {
    const targetUrl = new URL(target);
    const configuredSourceValue = process.env.DATABASE_URL?.trim();
    if (!configuredSourceValue) {
      return {
        status: 'not_configured',
        targetLabel,
        productionRestore: 'disabled',
        writesPerformed: false,
        reason: 'The source database identity is unavailable for safe target comparison.',
      };
    }
    const sourceValue = resolvedSourceDatabaseUrl();
    const sourceUrl = new URL(sourceValue);
    const databaseName = (url: URL) => decodeURIComponent(url.pathname).split('/').slice(1).join('/').toLowerCase();
    const port = (url: URL) => url.port || '5432';
    const sameEndpoint = targetUrl.hostname.toLowerCase() === sourceUrl.hostname.toLowerCase() &&
      port(targetUrl) === port(sourceUrl) &&
      databaseName(targetUrl) === databaseName(sourceUrl);
    if (sameEndpoint) {
      return {
        status: 'blocked_same_as_source',
        targetLabel,
        productionRestore: 'disabled',
        writesPerformed: false,
        reason: 'Recovery target matches the source host, port and database; isolated recovery is blocked.',
      };
    }
    if (targetUrl.protocol !== 'postgres:' && targetUrl.protocol !== 'postgresql:') {
      throw new Error('Unsupported recovery database protocol.');
    }
    return {
      status: 'identity_unverified',
      targetLabel,
      productionRestore: 'disabled',
      writesPerformed: false,
      reason: 'The target URL differs syntactically, but database identity and network isolation have not been proven. Restore remains disabled.',
    };
  } catch {
    return {
      status: 'invalid_target',
      targetLabel,
      productionRestore: 'disabled',
      writesPerformed: false,
      reason: 'Recovery target is invalid or cannot be safely validated.',
    };
  }
}

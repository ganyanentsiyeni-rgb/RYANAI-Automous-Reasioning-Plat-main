import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type BackupStatus = 'ready' | 'not_configured' | 'unavailable';

export interface BackupPreflight {
  status: BackupStatus;
  databaseConfigured: boolean;
  storageConfigured: boolean;
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
      destinationBucket: storage.bucket,
      sourceBuckets: [],
      pgDumpAvailable: false,
      reason: 'pg_dump is not installed in this runtime image.',
    };
  }
  return {
    status: 'ready',
    databaseConfigured: true,
    storageConfigured: true,
    destinationBucket: storage.bucket,
    sourceBuckets: (process.env.RYANAI_BACKUP_STORAGE_BUCKETS || '').split(',').map((v) => v.trim()).filter(Boolean),
    pgDumpAvailable: true,
  };
}

function pgDump(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file',
      file,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PGDATABASE: process.env.DATABASE_URL },
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(-4000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('pg_dump failed with exit code ' + code + (stderr ? ': ' + stderr : '.'))));
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
    const objectPath = '/' + encodeURIComponent(storage.bucket) + '/' + prefix.split('/').map(encodeURIComponent).join('/') + '/database.dump';

    await storageRequest(storage.baseUrl, storage.key, '/storage/v1/object' + objectPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-upsert': 'true',
        'x-client-info': 'ryanai-admin-resilience',
      },
      body: dump,
    });

    const manifest = {
      format: 'ryanai-admin-backup-v1',
      backupId,
      createdAt: new Date().toISOString(),
      gitCommit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null,
      databaseDump: { object: 'database.dump', bytes: dump.length, sha256 },
      secretsIncluded: false,
      recoveryTargetRequired: true,
    };
    await storageRequest(storage.baseUrl, storage.key, '/storage/v1/object/' + encodeURIComponent(storage.bucket) + '/' + prefix.split('/').map(encodeURIComponent).join('/') + '/manifest.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(manifest, null, 2),
    });

    return { status: 'succeeded', backupId, prefix, databaseBytes: dump.length, databaseSha256: sha256 };
  } catch (error) {
    return { status: 'failed', backupId, prefix, reason: error instanceof Error ? error.message : 'Backup failed.' };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

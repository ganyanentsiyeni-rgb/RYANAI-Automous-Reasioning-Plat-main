import { afterEach, describe, expect, it, vi } from 'vitest';

import { backupReadbackMatches, listDatabaseBackups, persistBackupArtifact, recoveryPreflight } from './adminResilience.js';

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

function configureStorage() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.SUPABASE_BACKUP_BUCKET = 'private-backups';
  process.env.RYANAI_BACKUP_RETENTION_DAYS = '30';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('admin resilience backup integrity', () => {
  it('accepts a complete read-back only when byte length and SHA-256 match', () => {
    const original = Buffer.from('complete database dump');
    expect(backupReadbackMatches(original, Buffer.from(original))).toBe(true);
    expect(backupReadbackMatches(original, Buffer.from('tampered database dump'))).toBe(false);
  });

  it('rejects a partial upload read-back even when its prefix matches', () => {
    const original = Buffer.from('complete database dump');
    const partial = original.subarray(0, 8);
    expect(backupReadbackMatches(original, partial)).toBe(false);
  });
});

describe('admin resilience backup artifact persistence', () => {
  const storage = { baseUrl: 'https://storage.example.test', key: 'test-key', bucket: 'private-backups' };
  const manifest = { format: 'ryanai-admin-backup-v1', backupId: 'backup-test' };
  const dump = Buffer.from('complete database dump');
  // Build read-back bodies from an exact-length copy. Buffer.slice() is a view into Node's shared
  // pool, so its .buffer exposes up to 8 KiB of unrelated bytes instead of just the dump's bytes.
  const storedBytes = (bytes: Buffer) => new Response(new Uint8Array(bytes));

  it('builds read-back fixtures from exact byte ranges', async () => {
    expect(Buffer.from(await storedBytes(dump).arrayBuffer())).toEqual(dump);
    expect(Buffer.from(await storedBytes(dump.subarray(0, 7)).arrayBuffer())).toEqual(dump.subarray(0, 7));
  });

  it('stops before manifest creation when Storage read-back is partial', async () => {
    const requestedPaths: string[] = [];
    const request = vi.fn(async (_base: string, _key: string, path: string): Promise<Response> => {
      requestedPaths.push(path);
      if (path.includes('/authenticated/')) return storedBytes(dump.subarray(0, 7));
      return new Response('{}');
    });

    await expect(persistBackupArtifact(storage, 'ryanai-admin/test-backup', dump, manifest, request))
      .rejects.toThrow('read-back size or SHA-256 integrity verification');
    expect(requestedPaths).toHaveLength(2);
    expect(requestedPaths[0]).toContain('/database.dump');
    expect(requestedPaths[1]).toContain('/authenticated/');
    expect(requestedPaths.some((path) => path.endsWith('/manifest.json'))).toBe(false);
  });

  it('reports manifest-write failure after a complete verified dump upload', async () => {
    const requestedPaths: string[] = [];
    const request = vi.fn(async (_base: string, _key: string, path: string): Promise<Response> => {
      requestedPaths.push(path);
      if (path.endsWith('/manifest.json')) throw new Error('manifest storage unavailable');
      if (path.includes('/authenticated/')) return storedBytes(dump);
      return new Response('{}');
    });

    await expect(persistBackupArtifact(storage, 'ryanai-admin/test-backup', dump, manifest, request))
      .rejects.toThrow('manifest storage unavailable');
    expect(requestedPaths).toHaveLength(3);
    expect(requestedPaths[0]).toContain('/database.dump');
    expect(requestedPaths[1]).toContain('/authenticated/');
    expect(requestedPaths[2]).toContain('/manifest.json');
  });
});

describe('admin resilience backup inventory', () => {
  it('parses backup folders, manifest metadata, and retention state', async () => {
    configureStorage();

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([
        { name: '2026-11-20-backup', id: null, created_at: '2026-11-20T10:00:00.000Z' },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { name: 'database.dump', id: 'dump-1', created_at: '2026-11-20T10:00:00.000Z', metadata: { size: 42 } },
        { name: 'manifest.json', id: 'manifest-1', created_at: '2026-11-20T10:00:00.000Z' },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        format: 'ryanai-admin-backup-v1',
        backupId: 'backup-1',
        createdAt: '2026-11-20T10:00:00.000Z',
        databaseDump: { bytes: 42, sha256: 'abc123' },
      }));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('available');
    expect(inventory.bucket).toBe('private-backups');
    expect(inventory.items).toEqual([
      expect.objectContaining({
        backupId: 'backup-1',
        prefix: 'ryanai-admin/2026-11-20-backup',
        databaseBytes: 42,
        databaseSha256: 'abc123',
        manifestPresent: true,
        retention: 'within_policy',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to object metadata when a manifest is absent', async () => {
    configureStorage();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([
        { name: 'backup-without-manifest', id: null },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { name: 'database.dump', id: 'dump-2', created_at: '2026-11-20T11:00:00.000Z', metadata: { size: 84 } },
      ]));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('available');
    expect(inventory.items[0]).toEqual(expect.objectContaining({
      backupId: 'backup-without-manifest',
      createdAt: '2026-11-20T11:00:00.000Z',
      databaseBytes: 84,
      databaseSha256: null,
      manifestPresent: false,
      retention: 'within_policy',
    }));
  });

  it('keeps inventory available when manifest retrieval fails', async () => {
    configureStorage();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([
        { name: 'manifest-unreadable', id: null },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { name: 'database.dump', id: 'dump-3', created_at: '2026-11-20T12:00:00.000Z', metadata: { size: 128 } },
        { name: 'manifest.json', id: 'manifest-3', created_at: '2026-11-20T12:00:00.000Z' },
      ]))
      .mockResolvedValueOnce(jsonResponse({ error: 'storage unavailable' }, 503));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('available');
    expect(inventory.items[0]).toEqual(expect.objectContaining({
      backupId: 'manifest-unreadable',
      databaseBytes: 128,
      databaseSha256: null,
      manifestPresent: false,
    }));
  });

  it('returns an unavailable inventory when the Storage listing payload is not an array', async () => {
    configureStorage();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'unexpected provider payload' }),
    );

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('unavailable');
    expect(inventory.items).toEqual([]);
    expect(inventory.reason).toContain('invalid object listing');
  });

  it('returns an unavailable inventory when storage listing fails', async () => {
    configureStorage();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'storage unavailable' }, 503),
    );

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('unavailable');
    expect(inventory.items).toEqual([]);
    expect(inventory.reason).toContain('HTTP 503');
  });
});

describe('admin resilience recovery target comparison', () => {
  it('blocks an exact recovery endpoint match even when credentials differ', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'postgresql://recovery:other@DB.EXAMPLE.COM:5432/ryanai';
    process.env.RYANAI_RECOVERY_TARGET_LABEL = 'recovery-drill';

    expect(recoveryPreflight()).toEqual(expect.objectContaining({
      status: 'blocked_same_as_source',
      targetLabel: 'recovery-drill',
      productionRestore: 'disabled',
      writesPerformed: false,
    }));
  });

  it('does not claim isolation for a separately hosted URL without proving target identity', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'postgresql://recovery:other@recovery.example.com:5432/ryanai-recovery';
    process.env.RYANAI_RECOVERY_TARGET_LABEL = 'recovery-drill';

    expect(recoveryPreflight()).toEqual(expect.objectContaining({
      status: 'identity_unverified',
      targetLabel: 'recovery-drill',
      productionRestore: 'disabled',
      writesPerformed: false,
    }));
  });

  it('does not infer endpoint identity from a matching database name on a different hostname', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db-primary.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'postgresql://recovery:other@db-alias.example.com:6432/ryanai';
    process.env.RYANAI_RECOVERY_TARGET_LABEL = 'recovery-drill';

    expect(recoveryPreflight()).toEqual(expect.objectContaining({
      status: 'identity_unverified',
      productionRestore: 'disabled',
      writesPerformed: false,
    }));
  });

  it('rejects invalid recovery targets without enabling restore', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'not-a-database-url';
    process.env.RYANAI_RECOVERY_TARGET_LABEL = 'recovery-drill';

    expect(recoveryPreflight()).toEqual(expect.objectContaining({
      status: 'invalid_target',
      productionRestore: 'disabled',
      writesPerformed: false,
    }));
  });
});

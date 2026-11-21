import { afterEach, describe, expect, it, vi } from 'vitest';

import { backupReadbackMatches, listDatabaseBackups, recoveryPreflight } from './adminResilience.js';

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
  it('blocks a recovery target with the same host and database as the source', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'postgresql://recovery:other@DB.EXAMPLE.COM:6543/ryanai';
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

  it('blocks a matching database name even when a misleading hostname alias is used', () => {
    process.env.DATABASE_URL = 'postgresql://source:secret@db-primary.example.com:5432/ryanai';
    process.env.RYANAI_RECOVERY_DATABASE_URL = 'postgresql://recovery:other@db-alias.example.com:6432/ryanai';
    process.env.RYANAI_RECOVERY_TARGET_LABEL = 'recovery-drill';

    expect(recoveryPreflight()).toEqual(expect.objectContaining({
      status: 'blocked_same_as_source',
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDatabaseBackups, recoveryPreflight } from './adminResilience.js';

const storageUrl = 'https://storage.example.test';
const sourceDatabaseUrl = 'postgresql://source:password@db-source.example.test:5432/app';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin resilience service', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', storageUrl);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    vi.stubEnv('SUPABASE_BACKUP_BUCKET', 'private-backups');
    vi.stubEnv('RYANAI_BACKUP_RETENTION_DAYS', '30');
    vi.stubEnv('DATABASE_URL', sourceDatabaseUrl);
    vi.stubEnv('RYANAI_RECOVERY_DATABASE_URL', '');
    vi.stubEnv('RYANAI_RECOVERY_TARGET_LABEL', '');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses a backup folder, dump metadata and manifest into inventory', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ name: 'backup-one', id: null }]))
      .mockResolvedValueOnce(jsonResponse([
        { name: 'database.dump', created_at: '2026-11-20T10:00:00.000Z', metadata: { size: 42 } },
        { name: 'manifest.json', created_at: '2026-11-20T10:00:00.000Z' },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        backupId: 'backup-id-one',
        createdAt: '2026-11-20T10:00:00.000Z',
        databaseDump: { bytes: 42, sha256: 'abc123' },
      }));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('available');
    expect(inventory.items).toHaveLength(1);
    expect(inventory.items[0]).toMatchObject({
      backupId: 'backup-id-one',
      prefix: 'ryanai-admin/backup-one',
      databaseBytes: 42,
      databaseSha256: 'abc123',
      manifestPresent: true,
      retention: 'within_policy',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a malformed Storage listing as unavailable instead of treating it as an empty inventory', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'unexpected provider payload' }));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('unavailable');
    expect(inventory.items).toEqual([]);
    expect(inventory.reason).toContain('invalid object listing');
  });

  it('reports Storage HTTP failures without fabricating a successful inventory', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'provider unavailable' }, 503));

    const inventory = await listDatabaseBackups();

    expect(inventory.status).toBe('unavailable');
    expect(inventory.items).toEqual([]);
    expect(inventory.reason).toContain('HTTP 503');
  });

  it('blocks a recovery target that resolves to the source database', () => {
    vi.stubEnv('RYANAI_RECOVERY_DATABASE_URL', 'postgresql://other:secret@DB-SOURCE.example.test:5432/app');
    vi.stubEnv('RYANAI_RECOVERY_TARGET_LABEL', 'same-database');

    expect(recoveryPreflight()).toMatchObject({
      status: 'blocked_same_as_source',
      productionRestore: 'disabled',
      writesPerformed: false,
    });
  });

  it('accepts a separately addressed PostgreSQL recovery target without performing writes', () => {
    vi.stubEnv('RYANAI_RECOVERY_DATABASE_URL', 'postgresql://recovery:secret@db-recovery.example.test:5432/recovery');
    vi.stubEnv('RYANAI_RECOVERY_TARGET_LABEL', 'isolated-drill');

    expect(recoveryPreflight()).toMatchObject({
      status: 'isolated_target_configured',
      targetLabel: 'isolated-drill',
      productionRestore: 'disabled',
      writesPerformed: false,
    });
  });

  it('rejects a malformed recovery target and keeps production restore disabled', () => {
    vi.stubEnv('RYANAI_RECOVERY_DATABASE_URL', 'not-a-database-url');
    vi.stubEnv('RYANAI_RECOVERY_TARGET_LABEL', 'invalid-target');

    expect(recoveryPreflight()).toMatchObject({
      status: 'invalid_target',
      productionRestore: 'disabled',
      writesPerformed: false,
    });
  });

  it('does not approve a recovery target when source database identity is missing', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('RYANAI_RECOVERY_DATABASE_URL', 'postgresql://recovery:secret@db-recovery.example.test:5432/recovery');
    vi.stubEnv('RYANAI_RECOVERY_TARGET_LABEL', 'isolated-drill');

    expect(recoveryPreflight()).toMatchObject({
      status: 'not_configured',
      productionRestore: 'disabled',
      writesPerformed: false,
    });
  });
});

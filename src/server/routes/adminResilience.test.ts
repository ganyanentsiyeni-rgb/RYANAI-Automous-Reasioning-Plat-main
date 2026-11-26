import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const resilience = vi.hoisted(() => ({
  backupPreflight: vi.fn(),
  createDatabaseBackup: vi.fn(),
  listDatabaseBackups: vi.fn(),
  listExpectedMigrationIds: vi.fn(),
  inspectSchemaMigrationArtifacts: vi.fn(),
  recoveryPreflight: vi.fn(),
}));
vi.mock('../../services/adminResilience.js', () => resilience);
vi.mock('./auth.js', () => ({
  requireAdmin: async (request: { authUser: { role: string } | null }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator authorization is required.' });
  },
  requireOwner: async (request: { authUser: { isOwner?: boolean } | null }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!request.authUser.isOwner) return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
  },
}));
import { adminResilienceRoutes } from './adminResilience.js';

let app: FastifyInstance;
const auditCreate = vi.fn();
const auditFindMany = vi.fn();
const auditFindFirst = vi.fn();

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.decorate('prisma', { jarvisAuditEvent: { create: auditCreate, findMany: auditFindMany, findFirst: auditFindFirst } } as never);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id ? {
      id: String(id),
      role: String(request.headers['x-test-role'] || 'user'),
      isOwner: request.headers['x-test-owner'] === 'true',
    } : null;
  });
  await app.register(adminResilienceRoutes);
  await app.ready();
});
afterAll(async () => app.close());

beforeEach(() => {
  vi.clearAllMocks();
  auditFindMany.mockResolvedValue([]);
  auditFindFirst.mockResolvedValue(null);
  resilience.backupPreflight.mockResolvedValue({
    status: 'ready', databaseConfigured: true, storageConfigured: true, privateDestinationVerified: true,
    destinationBucket: 'private-backups', sourceBuckets: [], pgDumpAvailable: true,
  });
  resilience.listDatabaseBackups.mockResolvedValue({
    status: 'available', bucket: 'private-backups', retentionDays: 30,
    listedAt: '2026-11-20T00:00:00.000Z', items: [], hasMore: false,
  });
  resilience.listExpectedMigrationIds.mockResolvedValue({ status: 'available', migrationIds: ['20261124170000_studio_artifact_idempotency'] });
  resilience.inspectSchemaMigrationArtifacts.mockResolvedValue({ status: 'source_artifacts_complete', schemaPresent: true, schemaBytes: 100, schemaSha256: 'a'.repeat(64), migrationCount: 1, migrations: [{ id: '20261124170000_studio_artifact_idempotency', sqlPresent: true, sqlBytes: 10, sqlSha256: 'b'.repeat(64) }], missingMigrationSql: [] });
  resilience.verifyDatabaseBackupArtifacts.mockResolvedValue([]);
  resilience.recoveryPreflight.mockReturnValue({
    status: 'not_configured', targetLabel: null, productionRestore: 'disabled', writesPerformed: false,
  });
  resilience.createDatabaseBackup.mockResolvedValue({
    status: 'succeeded', backupId: 'backup-1', prefix: 'ryanai-admin/example-backup-1',
    databaseBytes: 1234, databaseSha256: 'sha256-example',
  });
});

const ownerHeaders = { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' };
const adminHeaders = { 'x-test-user': 'admin-1', 'x-test-role': 'admin' };

describe('Admin resilience routes', () => {
  it('registers one maintenance read route and one maintenance write route', async () => {
    const routes = app.printRoutes();
    expect(routes).toMatch(/maintenance \(GET, HEAD, POST\)/);
  });

  it('exposes resilience status and keeps production restore disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/status', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().backup.status).toBe('ready');
    expect(response.json().recovery.productionRestore).toBe('disabled');
    expect(response.json().maintenance.automation).toBe('disabled');
  });

  it('exposes read-only backup inventory to administrators', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/backups', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().retentionDays).toBe(30);
    expect(resilience.listDatabaseBackups).toHaveBeenCalledTimes(1);
  });

  it('reports an isolated recovery target without enabling production restore', async () => {
    resilience.recoveryPreflight.mockReturnValue({
      status: 'identity_unverified', targetLabel: 'recovery-drill', productionRestore: 'disabled', writesPerformed: false, reason: 'Target identity has not been proven.'
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/status', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().recovery.status).toBe('identity_unverified');
    expect(response.json().recovery.productionRestore).toBe('disabled');
  });


  it('exposes an authenticated read-only recovery evidence report with explicit unknown states', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/recovery/report', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report.mode).toBe('read_only');
    expect(report.overallStatus).toBe('evidence_incomplete');
    expect(report.safety).toEqual({
      productionRestore: 'disabled',
      writesPerformed: false,
      migrationsExecuted: false,
      targetDatabaseQueried: false,
    });
    expect(report.schemaMigrationEvidence.appliedMigrationLedger).toBe('not_inspected');
    expect(report.schemaMigrationEvidence.expectedMigrationInventory.migrationIds).toContain('20261124170000_studio_artifact_idempotency');
    expect(report.backupEvidence.artifacts).toEqual([]);
    expect(report.acceptanceCriteria.every((item: { status: string }) => item.status === 'not_verified')).toBe(true);
    expect(resilience.listExpectedMigrationIds).toHaveBeenCalledTimes(1);
    expect(resilience.listDatabaseBackups).toHaveBeenCalledTimes(1);
  });

  it('does not expose the recovery report to unauthenticated requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/recovery/report' });
    expect(response.statusCode).toBe(401);
    expect(resilience.listExpectedMigrationIds).not.toHaveBeenCalled();
    expect(resilience.listDatabaseBackups).not.toHaveBeenCalled();
  });

  it('keeps backup checksum metadata explicitly unverified in the recovery report', async () => {
    resilience.listDatabaseBackups.mockResolvedValueOnce({
      status: 'available', bucket: 'private-backups', retentionDays: 30,
      listedAt: '2026-11-20T00:00:00.000Z', hasMore: false,
      items: [{
        backupId: 'backup-1', prefix: 'private/backup-1', createdAt: '2026-11-20T00:00:00.000Z',
        databaseBytes: 100, databaseSha256: 'recorded-digest', manifestPresent: true, retention: 'within_policy',
      }],
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/recovery/report', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().backupEvidence.artifacts[0]).toMatchObject({
      recordedSha256Present: true,
      artifactBytesRehashed: false,
      integrityStatus: 'not_verified',
    });
  });

  it('rejects backup execution for non-owners', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/backups', headers: adminHeaders });
    expect(response.statusCode).toBe(403);
    expect(resilience.createDatabaseBackup).not.toHaveBeenCalled();
  });

  it('allows owner backup and records redacted audit evidence', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/backups', headers: ownerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.backupId).toBe('backup-1');
    expect(response.json().auditReceipt.status).toBe('persisted');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'owner-1', eventType: 'admin.resilience.backup.succeeded', details: expect.objectContaining({ secretsIncluded: false }) }),
    }));
  });

  it('reports a successful artifact separately when its audit receipt fails', async () => {
    auditCreate.mockRejectedValueOnce(new Error('audit store unavailable'));
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/backups', headers: ownerHeaders });
    expect(response.statusCode).toBe(500);
    expect(response.json().result.status).toBe('succeeded');
    expect(response.json().auditReceipt.status).toBe('failed');
    expect(response.json().auditReceipt.reason).toContain('Manual reconciliation');
  });

  it('rejects maintenance scheduling by non-owners', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: adminHeaders,
      payload: { action: 'scheduled', title: 'Planned maintenance', reason: 'Routine database maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
    });
    expect(response.statusCode).toBe(403);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('schedules a future maintenance window and persists its audit event', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'scheduled', title: 'Planned maintenance', reason: 'Routine database maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().state).toBe('scheduled');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'owner-1', eventType: 'admin.maintenance.scheduled' }),
    }));
  });

  it('rejects invalid maintenance windows', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'scheduled', title: 'Invalid', reason: 'Routine database maintenance', startsAt: '2020-01-01T10:00:00.000Z', endsAt: '2020-01-01T11:00:00.000Z' },
    });
    expect(response.statusCode).toBe(400);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lists the latest durable maintenance state per window', async () => {
    auditFindMany.mockResolvedValue([
      { resourceId: 'window-1', eventType: 'admin.maintenance.started', details: { title: 'Planned maintenance', reason: 'Routine database maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' }, createdAt: new Date('2026-11-20T12:00:00.000Z') },
      { resourceId: 'window-1', eventType: 'admin.maintenance.scheduled', details: { title: 'Planned maintenance', reason: 'Routine database maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' }, createdAt: new Date('2026-11-20T11:00:00.000Z') },
    ]);
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/maintenance', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].state).toBe('started');
  });

  it('rejects an invalid lifecycle transition', async () => {
    auditFindFirst.mockResolvedValue({
      eventType: 'admin.maintenance.scheduled',
      details: { title: 'Planned maintenance', reason: 'Routine database maintenance' },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'completed', id: 'window-1' },
    });
    expect(response.statusCode).toBe(409);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('appends a completion event after a started window', async () => {
    auditFindFirst.mockResolvedValue({
      eventType: 'admin.maintenance.started',
      details: { title: 'Planned maintenance', reason: 'Routine database maintenance' },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'completed', id: 'window-1' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().state).toBe('completed');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'admin.maintenance.completed', resourceId: 'window-1' }),
    }));
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const resilience = vi.hoisted(() => ({
  backupPreflight: vi.fn(),
  createDatabaseBackup: vi.fn(),
  listDatabaseBackups: vi.fn(),
  recoveryPreflight: vi.fn(),
}));

vi.mock('../../services/adminResilience.js', () => resilience);
vi.mock('./auth.js', () => ({
  requireAdmin: async (
    request: { authUser: { role: string } | null },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator authorization is required.' });
  },
  requireOwner: async (
    request: { authUser: { role: string; isOwner?: boolean } | null },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
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
    (request as unknown as { authUser: unknown }).authUser = id
      ? {
          id: String(id),
          role: String(request.headers['x-test-role'] || 'user'),
          isOwner: request.headers['x-test-owner'] === 'true',
        }
      : null;
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
    status: 'ready',
    databaseConfigured: true,
    storageConfigured: true,
    destinationBucket: 'private-backups',
    sourceBuckets: [],
    pgDumpAvailable: true,
  });
  resilience.listDatabaseBackups.mockResolvedValue({ status: 'available', bucket: 'private-backups', items: [], retentionDays: 30, listedAt: '2026-11-20T00:00:00.000Z', hasMore: false });
  resilience.recoveryPreflight.mockReturnValue({ status: 'not_configured', targetLabel: null, productionRestore: 'disabled', writesPerformed: false });
  resilience.createDatabaseBackup.mockResolvedValue({
    status: 'succeeded',
    backupId: 'backup-1',
    prefix: 'ryanai-admin/example-backup-1',
    databaseBytes: 1234,
    databaseSha256: 'sha256-example',
  });
  resilience.listDatabaseBackups.mockResolvedValue({ status: 'available', bucket: 'private-backups', retentionDays: 30, listedAt: '2026-11-20T00:00:00.000Z', items: [], hasMore: false });
});

describe('Admin resilience routes', () => {
  it('exposes resilience status to administrators', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/resilience/status',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().backup.status).toBe('ready');
    expect(response.json().recovery.productionRestore).toBe('disabled');
  });

  it('exposes a read-only backup inventory to administrators', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('available');
    expect(response.json().retentionDays).toBe(30);
    expect(resilience.listDatabaseBackups).toHaveBeenCalledTimes(1);
  });



  it('reports recovery target validation without performing writes', async () => {
    resilience.recoveryPreflight.mockReturnValue({
      status: 'blocked_same_as_source',
      targetLabel: 'candidate-target',
      productionRestore: 'disabled',
      writesPerformed: false,
      reason: 'Recovery target resolves to the source database; isolated recovery is blocked.',
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/resilience/status',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().recovery.status).toBe('blocked_same_as_source');
    expect(response.json().recovery.writesPerformed).toBe(false);
  });

  it('exposes backup inventory as read-only administrator data', async () => {
    resilience.listDatabaseBackups.mockResolvedValue({
      status: 'available',
      bucket: 'private-backups',
      items: [{ backupId: 'backup-1', prefix: 'ryanai-admin/backup-1', createdAt: '2026-11-20T00:00:00.000Z', databaseBytes: 1234, databaseSha256: 'sha256-example', manifestPresent: true, retention: 'within_policy' }],
      retentionDays: 30,
      listedAt: '2026-11-20T00:00:00.000Z',
      hasMore: false,
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].manifestPresent).toBe(true);
    expect(response.json().items[0].retention).toBe('within_policy');
  });


  it('records a bounded maintenance request in the audit log', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
      payload: { summary: 'Database maintenance', startsAt: '2026-11-21T01:00:00.000Z', endsAt: '2026-11-21T02:00:00.000Z' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().request.status).toBe('requested');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'admin.maintenance.requested', actorId: 'admin-1' }),
    }));
  });

  it('rejects maintenance windows longer than seven days', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
      payload: { summary: 'Too long', startsAt: '2026-11-21T01:00:00.000Z', endsAt: '2026-12-01T01:00:00.000Z' },
    });
    expect(response.statusCode).toBe(400);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lists maintenance requests from the audit log', async () => {
    auditFindMany.mockResolvedValue([{
      id: 'event-1', actorId: 'admin-1', resourceId: 'request-1',
      eventType: 'admin.maintenance.requested', createdAt: new Date('2026-11-20T00:00:00.000Z'),
      details: { summary: 'Routine work', startsAt: '2026-11-21T01:00:00.000Z', endsAt: '2026-11-21T02:00:00.000Z', status: 'requested' },
    }]);
    const response = await app.inject({
      method: 'GET', url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().requests[0].summary).toBe('Routine work');
  });

  it('requires owner authorization to cancel a maintenance request', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance/request-1/cancel',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin', 'x-test-owner': 'false' },
    });
    expect(response.statusCode).toBe(403);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects backup execution for administrators who are not the owner', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'admin-2', 'x-test-role': 'admin', 'x-test-owner': 'false' },
    });

    expect(response.statusCode).toBe(403);
    expect(resilience.createDatabaseBackup).not.toHaveBeenCalled();
  });

  it('allows the configured owner to execute a backup and records an audit event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      success: true,
      result: {
        status: 'succeeded',
        backupId: 'backup-1',
        prefix: 'ryanai-admin/example-backup-1',
        databaseBytes: 1234,
        databaseSha256: 'sha256-example',
      },
    });
    expect(resilience.createDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: 'owner-1',
        eventType: 'admin.resilience.backup.succeeded',
        resourceId: 'backup-1',
        details: {
          prefix: 'ryanai-admin/example-backup-1',
          databaseBytes: 1234,
          databaseSha256: 'sha256-example',
          secretsIncluded: false,
        },
      },
    });
  });

  it('fails closed when backup configuration is unavailable', async () => {
    resilience.createDatabaseBackup.mockResolvedValue({
      status: 'not_configured',
      reason: 'Backup storage configuration is incomplete.',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().success).toBe(false);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});

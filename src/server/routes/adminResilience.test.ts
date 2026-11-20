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
    status: 'ready', databaseConfigured: true, storageConfigured: true,
    destinationBucket: 'private-backups', sourceBuckets: [], pgDumpAvailable: true,
  });
  resilience.listDatabaseBackups.mockResolvedValue({ status: 'available', bucket: 'private-backups', retentionDays: 30, listedAt: '2026-11-20T00:00:00.000Z', items: [], hasMore: false });
  resilience.listDatabaseBackups.mockResolvedValue({
    status: 'available', bucket: 'private-backups', retentionDays: 30,
    listedAt: '2026-11-20T00:00:00.000Z', items: [], hasMore: false,
  });
  resilience.recoveryPreflight.mockReturnValue({
    status: 'not_configured', targetLabel: null, productionRestore: 'disabled', writesPerformed: false,
  });
  resilience.createDatabaseBackup.mockResolvedValue({
    status: 'succeeded', backupId: 'backup-1', prefix: 'ryanai-admin/example-backup-1',
    databaseBytes: 1234, databaseSha256: 'sha256-example',
  });
  auditFindMany.mockResolvedValue([]);
  auditFindFirst.mockResolvedValue(null);
});

const ownerHeaders = { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' };
const adminHeaders = { 'x-test-user': 'admin-1', 'x-test-role': 'admin' };

describe('Admin resilience routes', () => {
  it('exposes resilience status to administrators', async () => {
const adminHeaders = { 'x-test-user': 'admin-1', 'x-test-role': 'admin' };
const ownerHeaders = { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' };

describe('Admin resilience routes', () => {
  it('exposes resilience status and keeps production restore disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/status', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().backup.status).toBe('ready');
    expect(response.json().recovery.productionRestore).toBe('disabled');
    expect(response.json().maintenance.status).toBe('audited_lifecycle');
  });

  it('exposes read-only backup inventory', async () => {
    resilience.listDatabaseBackups.mockResolvedValue({
      status: 'available', bucket: 'private-backups', retentionDays: 30,
      listedAt: '2026-11-20T00:00:00.000Z', hasMore: false,
      items: [{ backupId: 'backup-1', prefix: 'ryanai-admin/backup-1', createdAt: '2026-11-20T00:00:00.000Z', databaseBytes: 1234, databaseSha256: 'sha256-example', manifestPresent: true, retention: 'within_policy' }],
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/backups', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].manifestPresent).toBe(true);
    expect(response.json().items[0].retention).toBe('within_policy');
  });

  it('reports a same-as-source recovery target as blocked without writes', async () => {
    resilience.recoveryPreflight.mockReturnValue({
      status: 'blocked_same_as_source', targetLabel: 'candidate-target',
      productionRestore: 'disabled', writesPerformed: false,
    });
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/status', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().recovery.status).toBe('blocked_same_as_source');
    expect(response.json().recovery.writesPerformed).toBe(false);
  });

  it('rejects backup execution for a non-owner administrator', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/backups', headers: { ...adminHeaders, 'x-test-owner': 'false' } });
    expect(response.statusCode).toBe(403);
    expect(resilience.createDatabaseBackup).not.toHaveBeenCalled();
  });

  it('allows the owner to execute a backup and records redacted audit evidence', async () => {
  it('exposes read-only backup inventory to administrators', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/backups', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().retentionDays).toBe(30);
    expect(resilience.listDatabaseBackups).toHaveBeenCalledTimes(1);
  });


  it('records a future maintenance request as an audited owner action', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' },
      payload: { reason: 'Planned database maintenance', startsAt, endsAt },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('requested');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'admin.resilience.maintenance.requested', details: expect.objectContaining({ infrastructureChanged: false }) }) }));
  });

  it('rejects maintenance requests from non-owner administrators', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'admin-2', 'x-test-role': 'admin', 'x-test-owner': 'false' },
      payload: { reason: 'Planned database maintenance', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() },
    });
    expect(response.statusCode).toBe(403);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects maintenance windows that are in the past or exceed the maximum duration', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance',
      headers: { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' },
      payload: { reason: 'Invalid maintenance window', startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(response.statusCode).toBe(400);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lists maintenance history from durable audit events', async () => {
    auditFindMany.mockResolvedValue([{ id: 'audit-1', actorId: 'owner-1', eventType: 'admin.resilience.maintenance.requested', resourceId: 'maint-1', createdAt: new Date('2026-11-20T00:00:00.000Z'), details: { maintenanceId: 'maint-1', reason: 'Planned database maintenance', startsAt: '2026-11-21T00:00:00.000Z', endsAt: '2026-11-21T01:00:00.000Z', requestedAt: '2026-11-20T00:00:00.000Z' } }]);
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/maintenance', headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().records[0].id).toBe('maint-1');
  });
  it('rejects backup execution for administrators who are not the owner', async () => {
  it('rejects backup execution for non-owners', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/backups',
      headers: { 'x-test-user': 'admin-2', 'x-test-role': 'admin', 'x-test-owner': 'false' },
    });
    expect(response.statusCode).toBe(403);
    expect(resilience.createDatabaseBackup).not.toHaveBeenCalled();
  });

  it('allows owner backup and records an audit event', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/backups', headers: ownerHeaders });
    expect(response.statusCode).toBe(202);
    expect(response.json().result.backupId).toBe('backup-1');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'admin.resilience.backup.succeeded', details: expect.objectContaining({ secretsIncluded: false }) }),
    }));
  });

  it('records a future maintenance request as an owner-only audited action', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { reason: 'Planned database maintenance', startsAt, endsAt },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('requested');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'admin.resilience.maintenance.requested', details: expect.objectContaining({ infrastructureChanged: false }) }),
    }));
  });

  it('rejects maintenance requests from non-owner administrators', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: { ...adminHeaders, 'x-test-owner': 'false' },
      payload: { reason: 'Planned database maintenance', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() },
      data: expect.objectContaining({ actorId: 'owner-1', eventType: 'admin.resilience.backup.succeeded' }),
    }));
  });

  it('rejects maintenance scheduling by a non-owner', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance',
      headers: { ...adminHeaders, 'x-test-owner': 'false' },
      payload: { action: 'scheduled', title: 'Patch', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
    });
    expect(response.statusCode).toBe(403);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects past or invalid maintenance windows', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { reason: 'Invalid maintenance window', startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(response.statusCode).toBe(400);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lists maintenance requests from the durable audit ledger', async () => {
    auditFindMany.mockResolvedValue([{
      id: 'audit-1', actorId: 'owner-1', eventType: 'admin.resilience.maintenance.requested',
      resourceId: 'maint-1', createdAt: new Date('2026-11-20T00:00:00.000Z'),
      details: { maintenanceId: 'maint-1', reason: 'Planned database maintenance', startsAt: '2026-11-21T00:00:00.000Z', endsAt: '2026-11-21T01:00:00.000Z', requestedAt: '2026-11-20T00:00:00.000Z' },
    }]);
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/maintenance', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().records[0].id).toBe('maint-1');
  });

  it('closes a maintenance record by appending a lifecycle audit event', async () => {
    auditFindFirst.mockResolvedValueOnce({ id: 'request-event', resourceId: 'maint-1' }).mockResolvedValueOnce(null);
    const response = await app.inject({ method: 'POST', url: '/api/admin/resilience/maintenance/maint-1/close', headers: ownerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('closed');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'admin.resilience.maintenance.closed', resourceId: 'maint-1' }),
    }));
  it('schedules a future maintenance window and persists an audit event', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'scheduled', title: 'Planned maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().state).toBe('scheduled');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'owner-1', eventType: 'admin.maintenance.scheduled' }),
    }));
  });

  it('rejects invalid lifecycle transitions', async () => {
    auditFindFirst.mockResolvedValue({
      eventType: 'admin.maintenance.scheduled',
      details: { title: 'Planned maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/admin/resilience/maintenance', headers: ownerHeaders,
      payload: { action: 'completed', id: 'window-1' },
    });
    expect(response.statusCode).toBe(409);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('lists the latest audited maintenance state per window', async () => {
    auditFindMany.mockResolvedValue([{
      resourceId: 'window-1',
      eventType: 'admin.maintenance.started',
      details: { title: 'Planned maintenance', startsAt: '2027-01-01T10:00:00.000Z', endsAt: '2027-01-01T11:00:00.000Z' },
      createdAt: new Date('2026-11-20T12:00:00.000Z'),
    }]);
    const response = await app.inject({ method: 'GET', url: '/api/admin/resilience/maintenance', headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].state).toBe('started');
    expect(response.json().items[0].title).toBe('Planned maintenance');
  });
});

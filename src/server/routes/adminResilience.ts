import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireOwner } from './auth.js';
import { backupPreflight, createDatabaseBackup, listDatabaseBackups, listExpectedMigrationIds, recoveryPreflight, verifyDatabaseBackupArtifacts } from '../../services/adminResilience.js';

interface MaintenanceBody {
  action?: 'scheduled' | 'started' | 'completed' | 'cancelled';
  id?: string;
  title?: string;
  reason?: string;
  startsAt?: string;
  endsAt?: string;
}
interface MaintenanceDetails {
  title?: string;
  reason?: string;
  startsAt?: string;
  endsAt?: string;
}

const MAX_MAINTENANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const adminResilienceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/admin/resilience/status', { preHandler: requireAdmin }, async () => {
    const backup = await backupPreflight();
    return {
      status: 'available',
      generatedAt: new Date().toISOString(),
      online: true,
      backup,
      recovery: recoveryPreflight(),
      selfPatch: {
        status: process.env.RYANAI_GITHUB_TOKEN && process.env.RYANAI_GITHUB_REPOSITORY ? 'configured' : 'not_configured',
        mode: 'isolated-github-pr',
      },
      maintenance: { status: 'audited_lifecycle', automation: 'disabled' },
    };
  });

  fastify.get('/api/admin/resilience/backups', { preHandler: requireAdmin }, async () => listDatabaseBackups());

  fastify.get('/api/admin/resilience/recovery/report', { preHandler: requireAdmin }, async () => {
    const [inventory, migrations] = await Promise.all([
      listDatabaseBackups(),
      listExpectedMigrationIds(),
    ]);
    const [artifactVerifications] = await Promise.all([verifyDatabaseBackupArtifacts(inventory)]);
    const verificationById = new Map(artifactVerifications.map((item) => [item.backupId, item]));
    const recovery = recoveryPreflight();
    return {
      reportId: randomUUID(),
      generatedAt: new Date().toISOString(),
      sourceCommit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null,
      sourceDatabaseLabel: process.env.RYANAI_SOURCE_DATABASE_LABEL?.trim() || 'unknown',
      recoveryTargetLabel: recovery.targetLabel,
      mode: 'read_only',
      overallStatus: 'evidence_incomplete',
      safety: {
        productionRestore: 'disabled',
        writesPerformed: false,
        migrationsExecuted: false,
        targetDatabaseQueried: false,
      },
      backupEvidence: {
        status: inventory.status,
        listedAt: inventory.listedAt,
        artifacts: inventory.items.map((item) => ({
          backupId: item.backupId,
          createdAt: item.createdAt,
          databaseBytes: item.databaseBytes,
          manifestPresent: item.manifestPresent,
          recordedSha256Present: Boolean(item.databaseSha256),
          artifactBytesRehashed: verificationById.get(item.backupId)?.bytesRehashed ?? false,
          integrityStatus: verificationById.get(item.backupId)?.status ?? 'not_verified',
          actualBytes: verificationById.get(item.backupId)?.actualBytes ?? null,
          verificationReason: verificationById.get(item.backupId)?.reason ?? 'Artifact verification was not performed.',
          retention: item.retention,
        })),
        verificationLimit: 'At most 10 artifacts and 256 MiB per artifact are re-downloaded per report.',
        reason: inventory.reason || 'Artifact bytes are freshly re-downloaded and hashed where bounded manifest evidence is complete.',
      },
      schemaMigrationEvidence: {
        status: 'not_verified',
        expectedMigrationInventory: migrations,
        appliedMigrationLedger: 'not_inspected',
        requiredSchema: 'not_inspected',
        compatibility: 'not_verified',
        reason: 'The recovery target migration ledger and schema have not been queried. This endpoint does not connect to the target or execute SQL.',
      },
      targetEvidence: {
        preflightStatus: recovery.status,
        identityStatus: recovery.status === 'blocked_same_as_source' ? 'blocked' : 'identity_unverified',
        networkIsolation: 'not_verified',
        nonProductionDesignation: 'not_verified',
        reason: recovery.reason || 'Independent database identity and network isolation evidence is unavailable.',
      },
      acceptanceCriteria: [
        { id: 'artifact_integrity', status: 'not_verified' },
        { id: 'schema_migration_compatibility', status: 'not_verified' },
        { id: 'target_identity_and_isolation', status: 'not_verified' },
        { id: 'authentication_and_rls', status: 'not_verified' },
        { id: 'critical_workflows_and_event_continuity', status: 'not_verified' },
        { id: 'data_integrity', status: 'not_verified' },
        { id: 'rpo_rto_measurement', status: 'not_verified' },
        { id: 'audit_receipt_and_rollback_plan', status: 'not_verified' },
      ],
    };
  });


  fastify.get('/api/admin/resilience/maintenance', { preHandler: requireAdmin }, async () => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { startsWith: 'admin.maintenance.' } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const latest = new Map<string, { id: string; state: string; title: string; reason: string; startsAt: string | null; endsAt: string | null; updatedAt: string }>();
    for (const event of events) {
      if (!event.resourceId || latest.has(event.resourceId)) continue;
      const details = event.details && typeof event.details === 'object' ? event.details as MaintenanceDetails : {};
      latest.set(event.resourceId, {
        id: event.resourceId,
        state: event.eventType.replace('admin.maintenance.', ''),
        title: typeof details.title === 'string' ? details.title : 'Maintenance window',
        reason: typeof details.reason === 'string' ? details.reason : 'No reason recorded',
        startsAt: typeof details.startsAt === 'string' ? details.startsAt : null,
        endsAt: typeof details.endsAt === 'string' ? details.endsAt : null,
        updatedAt: event.createdAt.toISOString(),
      });
    }
    return { status: 'available', items: Array.from(latest.values()) };
  });

  fastify.post<{ Body: MaintenanceBody }>('/api/admin/resilience/maintenance', {
    preHandler: requireOwner,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = request.body;
    const action = body?.action;
    if (!body || !action || !['scheduled', 'started', 'completed', 'cancelled'].includes(action)) {
      return reply.code(400).send({ error: 'A valid maintenance action is required.' });
    }

    const now = Date.now();
    const id = action === 'scheduled' ? randomUUID() : body.id?.trim();
    if (!id) return reply.code(400).send({ error: 'A maintenance window ID is required.' });

    let details: Prisma.InputJsonObject;
    if (action === 'scheduled') {
      const startsAt = body.startsAt ? Date.parse(body.startsAt) : Number.NaN;
      const endsAt = body.endsAt ? Date.parse(body.endsAt) : Number.NaN;
      if (
        !body.title?.trim() || body.title.trim().length > 120 ||
        !body.reason?.trim() || body.reason.trim().length < 8 || body.reason.trim().length > 500 ||
        !Number.isFinite(startsAt) || !Number.isFinite(endsAt) ||
        startsAt <= now || endsAt <= startsAt || endsAt - startsAt > MAX_MAINTENANCE_WINDOW_MS
      ) {
        return reply.code(400).send({ error: 'Provide a title, reason and valid future maintenance window no longer than 30 days.' });
      }
      details = {
        title: body.title.trim(),
        reason: body.reason.trim(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      };
    } else {
      const prior = await fastify.prisma.jarvisAuditEvent.findFirst({
        where: { resourceId: id, eventType: { startsWith: 'admin.maintenance.' } },
        orderBy: { createdAt: 'desc' },
      });
      if (!prior) return reply.code(404).send({ error: 'Maintenance window not found.' });
      const state = prior.eventType.replace('admin.maintenance.', '');
      const valid = !['completed', 'cancelled'].includes(state) &&
        ((action === 'started' && state === 'scheduled') ||
         (action === 'completed' && state === 'started') ||
         (action === 'cancelled' && ['scheduled', 'started'].includes(state)));
      if (!valid) return reply.code(409).send({ error: 'Invalid maintenance lifecycle transition.' });
      details = prior.details && typeof prior.details === 'object' && !Array.isArray(prior.details)
        ? prior.details as Prisma.InputJsonObject
        : {};
    }

    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser?.id || 'unknown',
        eventType: 'admin.maintenance.' + action,
        resourceId: id,
        details,
      },
    });
    return reply.code(action === 'scheduled' ? 201 : 202).send({ success: true, id, state: action });
  });

  fastify.post('/api/admin/resilience/backups', {
    preHandler: requireOwner,
    config: { rateLimit: { max: 1, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const result = await createDatabaseBackup();
    if (result.status === 'succeeded') {
      try {
        await fastify.prisma.jarvisAuditEvent.create({
          data: {
            actorId: request.authUser?.id || 'unknown',
            eventType: 'admin.resilience.backup.succeeded',
            resourceId: result.backupId,
            details: {
              prefix: result.prefix,
              databaseBytes: result.databaseBytes,
              databaseSha256: result.databaseSha256,
              secretsIncluded: false,
            },
          },
        });
      } catch {
        return reply.code(500).send({
          success: false,
          result,
          auditReceipt: { status: 'failed', reason: 'Backup artifact succeeded, but its audit receipt could not be persisted. Manual reconciliation is required.' },
        });
      }
      return reply.code(200).send({ success: true, result, auditReceipt: { status: 'persisted' } });
    }

    try {
      await fastify.prisma.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser?.id || 'unknown',
          eventType: 'admin.resilience.backup.failed',
          resourceId: result.backupId || null,
          details: { reason: result.reason || 'Backup failed.' },
        },
      });
    } catch {
      return reply.code(500).send({
        success: false,
        result,
        auditReceipt: { status: 'failed', reason: 'Backup failure occurred and its audit receipt could not be persisted.' },
      });
    }
    return reply.code(result.status === 'not_configured' ? 503 : 500).send({
      success: false, result, auditReceipt: { status: 'persisted' },
    });
  });
};

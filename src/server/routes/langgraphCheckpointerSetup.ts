import type { FastifyPluginAsync } from 'fastify';
import { checkpointer, postgresPool } from '../../db/langgraph-checkpointer.js';
import { inspectDatabaseSchema } from '../databaseSchema.js';
import { requireOwner } from './auth.js';

let setupInFlight: Promise<void> | null = null;

async function readCheckpointerStatus() {
  return inspectDatabaseSchema(async (sql) => {
    const result = await postgresPool.query(sql);
    return { rows: result.rows as Array<Record<string, unknown>> };
  });
}

/**
 * Explicit, owner-only one-time LangGraph checkpoint initialization.
 * Normal API startup remains DDL-free; this endpoint invokes the package's
 * supported PostgresSaver.setup() path and verifies its migration ledger.
 */
export const langGraphCheckpointerSetupRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireOwner);

  fastify.post('/api/admin/operations/langgraph-checkpointer/setup', async (_request, reply) => {
    try {
      const before = await readCheckpointerStatus();
      if (before.agentCheckpointer) {
        const current = await postgresPool.query(
          'SELECT MAX(v) AS version FROM public.checkpoint_migrations',
        );
        return {
          status: 'already_initialized',
          agentCheckpointer: true,
          migrationVersion: Number(current.rows[0]?.version ?? -1),
        };
      }

      if (!setupInFlight) {
        setupInFlight = checkpointer.setup().finally(() => {
          setupInFlight = null;
        });
      }
      await setupInFlight;

      const after = await readCheckpointerStatus();
      const migration = await postgresPool.query(
        'SELECT MAX(v) AS version FROM public.checkpoint_migrations',
      );
      const migrationVersion = Number(migration.rows[0]?.version ?? -1);

      if (!after.agentCheckpointer || !Number.isInteger(migrationVersion) || migrationVersion < 5) {
        fastify.log.error(
          { agentCheckpointer: after.agentCheckpointer, migrationVersion },
          'LangGraph checkpointer setup completed without the expected schema version.',
        );
        return reply.code(503).send({
          status: 'verification_failed',
          agentCheckpointer: false,
          migrationVersion,
        });
      }

      fastify.log.info(
        { migrationVersion },
        'Owner-triggered LangGraph checkpointer initialization verified.',
      );
      return {
        status: 'initialized',
        agentCheckpointer: true,
        migrationVersion,
      };
    } catch {
      fastify.log.error('Owner-triggered LangGraph checkpointer initialization failed.');
      return reply.code(503).send({
        status: 'failed',
        agentCheckpointer: false,
        error: 'Initialization failed. Check the service logs for the sanitized failure event.',
      });
    }
  });
};

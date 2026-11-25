import { arch, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { requireAdmin } from './auth.js';
import type { FastifyPluginAsync } from 'fastify';
import { snapshotRuntimeMetrics } from '../../telemetry/runtimeMetrics.js';

/**
 * Register admin-only, read-only host and process diagnostics.
 * Host resource figures describe the runtime host/container view exposed by Node.
 * Database readiness remains independently reported by /health.
 */
export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/metrics', async () => {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    return {
      status: 'available',
      readiness: 'not_checked',
      runtimeMetrics: snapshotRuntimeMetrics(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: {
        status: 'unknown',
        driver: 'PostgreSQL (@langchain/langgraph-checkpoint-postgres)',
        note: 'Database readiness is reported by the independent /health endpoint.',
      },
      system: {
        nodeVersion: process.version,
        platform: platform(),
        platformRelease: release(),
        architecture: arch(),
        logicalProcessors: cpus().length,
        loadAverage: loadavg(),
        totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(freemem() / 1024 / 1024),
        rssMemoryMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
        externalMemoryMB: Math.round(memory.external / 1024 / 1024),
        arrayBuffersMB: Math.round(memory.arrayBuffers / 1024 / 1024),
        processCpuUserMs: Math.round(cpu.user / 1000),
        processCpuSystemMs: Math.round(cpu.system / 1000),
      },
    };
  });
};

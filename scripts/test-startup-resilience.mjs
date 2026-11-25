#!/usr/bin/env node
/**
 * Exercise production startup against disposable CI PostgreSQL/Redis services.
 * Production and staging fail closed: a required dependency that fails its startup
 * check stops the process before the API listener opens (src/server/startupConfig.ts).
 * Isolated test runtimes keep degraded startup, where liveness is up and readiness
 * reports the failed dependency. Missing checkpoint schema is simulated only in disposable
 * PostgreSQL; a final clean restart proves recovery after transient faults.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const timeoutMs = Number(process.env.STARTUP_RESILIENCE_TIMEOUT_MS || 20_000);
const launcher = new URL('../dist/server/server/launcher.js', import.meta.url);

if (!databaseUrl || !redisUrl) {
  throw new Error('DATABASE_URL and REDIS_URL must target disposable CI services.');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an ephemeral test port.'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function runChild(label, env) {
  const child = spawn(process.execPath, [launcher.pathname], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ...env,
      HOST: '127.0.0.1',
      JWT_SECRET: 'isolated-ci-startup-secret-at-least-32-characters',
      SCHEDULER_ENABLED: 'false',
      ALERTS_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  return {
    child,
    get output() { return output; },
    async exited() {
      let timer;
      try {
        return await Promise.race([
          new Promise((resolve, reject) => {
            child.once('error', reject);
            // 'close' (not 'exit') guarantees the captured output is complete before callers read it.
            child.once('close', (code, signal) => resolve({ code, signal }));
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(label + ' did not exit within ' + timeoutMs + 'ms'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function expectDegradedStartup(label, env, expectedServices) {
  const port = await reservePort();
  const process = runChild(label, { ...env, PORT: String(port) });
  const deadline = Date.now() + timeoutMs;
  let live = false;
  let readiness;

  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(label + ' exited before exposing liveness. Output: ' + process.output);
    }

    try {
      const liveResponse = await fetch('http://127.0.0.1:' + port + '/livez', {
        signal: AbortSignal.timeout(1000),
      });
      const liveBody = await liveResponse.json();
      live = liveResponse.ok && liveBody.status === 'alive';

      const readyResponse = await fetch('http://127.0.0.1:' + port + '/readyz', {
        // Readiness probes have their own bounded 1.5s dependency checks.
        // Allow the HTTP request to finish instead of aborting it prematurely.
        signal: AbortSignal.timeout(1000),
        // inspectReadiness allows up to 1500ms for dependency probes; leave time for the 503 response.
        signal: AbortSignal.timeout(2500),
      });
      const readyBody = await readyResponse.json();
      if (readyResponse.status === 503 && readyBody.status === 'degraded') {
        readiness = readyBody;
        break;
      }
    } catch {
      // Continue waiting for the liveness listener and degraded readiness response.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!live || !readiness) {
    process.child.kill('SIGKILL');
    throw new Error(
      label + ' did not expose live-but-not-ready state within ' + timeoutMs
      + 'ms. Output: ' + process.output,
    );
  }

  for (const [dependency, expected] of Object.entries(expectedServices)) {
    if (readiness.services?.[dependency] !== expected) {
      process.child.kill('SIGKILL');
      throw new Error(
        label + ' reported ' + dependency + '=' + readiness.services?.[dependency]
        + '; expected ' + expected + '. Output: ' + process.output,
      );
    }
  }

  console.log('PASS ' + label + ': liveness remains available while readiness fails closed');
  process.child.kill('SIGTERM');
  await new Promise((resolve) => process.child.once('exit', resolve));
}

// Production fail-closed contract: the process exits non-zero, names exactly the unavailable
// dependencies in the policy's stable order, and never opens the API listener.
async function expectFailClosedStartup(label, env, unavailable) {
  const port = await reservePort();
  const process = runChild(label, { ...env, PORT: String(port) });
  const { code, signal } = await process.exited();
  const expected = 'production startup blocked: required dependency checks failed for ' + unavailable.join(', ') + '.';
  if (code === 0 || signal) {
    throw new Error(label + ' did not fail closed; exit code=' + code + ' signal=' + signal + '. Output: ' + process.output);
  }
  if (!process.output.includes(expected)) {
    throw new Error(label + ' did not report the expected fail-closed block (' + expected + '). Output: ' + process.output);
  }
  console.log('PASS ' + label + ': production startup failed closed before the API listener opened');
}

async function withMissingCheckpointerSchema(run) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // This test targets only the disposable CI database prepared by db:setup.
    // Hide the migration ledger so startup must fail its read-only schema check.
    await pool.query(
      'ALTER TABLE public.checkpoint_migrations RENAME TO checkpoint_migrations_startup_test',
    );
    try {
      await run();
    } finally {
      await pool.query(
        'ALTER TABLE public.checkpoint_migrations_startup_test RENAME TO checkpoint_migrations',
      );
    }
  } finally {
    await pool.end();
  }
}

async function expectMissingCheckpointerSchema() {
  await withMissingCheckpointerSchema(() => expectFailClosedStartup(
    'Agent checkpointer schema missing',
    { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl },
    ['PostgreSQL', 'agent checkpointer'],
  ));
}

async function expectHealthyRecovery() {
  const port = await reservePort();
  const process = runChild('healthy recovery', {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    PORT: String(port),
  });
  const deadline = Date.now() + timeoutMs;
  let health;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error('Healthy recovery process exited early. Output: ' + process.output);
    }
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/readyz', {
        signal: AbortSignal.timeout(1000),
      });
      const body = await response.json();
      if (response.ok && body.status === 'online') {
        health = body;
        break;
      }
    } catch {
      // Continue waiting for startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!health) {
    process.child.kill('SIGKILL');
    throw new Error('Healthy recovery did not become ready. Output: ' + process.output);
  }
  for (const dependency of ['database', 'redis', 'agentCheckpointer', 'api']) {
    if (health.services?.[dependency] !== true) {
      process.child.kill('SIGKILL');
      throw new Error('Healthy recovery reported ' + dependency + ' as unavailable.');
    }
  }
  console.log('PASS healthy restart: PostgreSQL, Redis, checkpointer and API report ready');
  process.child.kill('SIGTERM');
  await new Promise((resolve) => process.child.once('exit', resolve));
}

try {
  const unreachableDatabase = new URL(databaseUrl);
  unreachableDatabase.port = '1';
  // Production fails closed when a required dependency is down; the listener never opens.
  await expectFailClosedStartup(
    'PostgreSQL unavailable',
    { DATABASE_URL: unreachableDatabase.toString(), REDIS_URL: redisUrl },
    ['PostgreSQL', 'agent checkpointer'],
  );
  // Isolated test runtimes keep degraded startup: live, with readiness naming the failed dependency.
  await expectDegradedStartup(
    'PostgreSQL unavailable in isolated test runtime',
    { NODE_ENV: 'test', DATABASE_URL: unreachableDatabase.toString(), REDIS_URL: redisUrl },
    { database: false, redis: true, agentCheckpointer: false },
  );

  // Hide the migrated checkpoint ledger in disposable CI PostgreSQL.
  // Startup must fail closed without trying to create or repair the schema.
  await expectMissingCheckpointerSchema();

  const unreachableRedis = new URL(redisUrl);
  unreachableRedis.port = '1';
  await expectFailClosedStartup(
    'Redis unavailable',
    { DATABASE_URL: databaseUrl, REDIS_URL: unreachableRedis.toString() },
    ['Redis'],
  );

  // Combined outage: startup aggregates every unavailable dependency in
  // stable diagnostic order, including the dependent checkpointer check.
  const combinedUnavailableDatabase = new URL(databaseUrl);
  combinedUnavailableDatabase.port = '1';
  await expectFailClosedStartup(
    'PostgreSQL and Redis unavailable together',
    {
      DATABASE_URL: combinedUnavailableDatabase.toString(),
      REDIS_URL: unreachableRedis.toString(),
    },
    ['PostgreSQL', 'Redis', 'agent checkpointer'],
  );

  await expectHealthyRecovery();
  console.log('Startup resilience checks passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

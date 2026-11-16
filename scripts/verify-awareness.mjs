#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const DEFAULT_ENDPOINT = 'https://ryanai-api.onrender.com/api/agent/ops/awareness';

function assertAwarenessPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Response JSON must be an object.');
  }
  if (payload.source !== 'persisted-agent-runs-and-live-worker-observer') {
    throw new Error('Response is missing the expected operational-awareness source marker.');
  }
  if (!payload.worker || typeof payload.worker !== 'object' || !['not_started', 'running', 'stopped'].includes(payload.worker.state)) {
    throw new Error('Response is missing a valid worker state.');
  }
  if (!payload.report || typeof payload.report !== 'object' || !Number.isInteger(payload.report.total)) {
    throw new Error('Response is missing the operational report total.');
  }
  if (!Array.isArray(payload.tasks)) {
    throw new Error('Response is missing the tasks array.');
  }
  return {
    generatedAt: payload.generatedAt ?? null,
    connectivity: payload.connectivity ?? 'unknown',
    workerState: payload.worker.state,
    taskCount: payload.report.total,
    returnedTaskCount: payload.tasks.length,
  };
}

export async function verifyOperationalAwareness({
  endpoint = process.env.RYANAI_API_URL || DEFAULT_ENDPOINT,
  token = process.env.RYANAI_API_TOKEN,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = response.headers?.get?.('content-type') ?? '';
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Operational awareness returned HTTP ${response.status} ${response.statusText || ''}. Check API availability, authentication, and the database schema.`.trim());
  }
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`Expected application/json but received "${contentType || 'no content-type'}".`);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('The endpoint returned invalid JSON.');
  }

  return assertAwarenessPayload(payload);
}

async function main() {
  const endpoint = process.env.RYANAI_API_URL || DEFAULT_ENDPOINT;
  console.log(`[check] GET ${endpoint}`);
  const startedAt = Date.now();
  try {
    const result = await verifyOperationalAwareness({ endpoint });
    console.log(`[pass] HTTP 2xx; operational-awareness payload validated in ${Date.now() - startedAt}ms`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

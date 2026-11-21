import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const FIXTURE_PATH = 'benchmarks/fixtures/synthetic-component-workloads.v1.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function executeFixture(item) {
  const input = item.input;
  switch (item.id) {
    case 'api-payload':
      return { status: input.status, bodyKeys: Object.keys(input.body).sort() };
    case 'queue-scheduler':
      return {
        eligibleOrder: input.tasks.filter((task) => task.eligible && task.kind === 'reasoning').map((task) => task.id),
        excludedCount: input.tasks.filter((task) => !task.eligible || task.kind !== 'reasoning').length
      };
    case 'memory-ranking': {
      const terms = new Set(input.query.toLowerCase().split(/\s+/));
      const ranked = input.documents.map((doc) => ({
        id: doc.id,
        relevant: doc.relevant,
        score: doc.text.toLowerCase().split(/\s+/).filter((term) => terms.has(term)).length
      })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return { topRelevant: ranked[0]?.relevant === true, resultCount: ranked.length };
    }
    case 'inference-fixture': {
      const answer = input.fixtures[input.promptId];
      if (!answer) throw new Error('Fixture miss: inference must fail closed');
      return { grounded: answer.grounded, answer: answer.answer };
    }
    case 'media-metadata':
      return {
        durationMs: input.asset.durationMs,
        sampleRate: input.asset.sampleRate,
        channels: input.asset.channels
      };
    case 'comms-approval':
      return {
        status: input.message.approved ? 'approved-for-review' : 'awaiting-human-approval',
        dispatchCount: input.dispatchEnabled && input.message.approved ? 1 : 0
      };
    default:
      throw new Error(`Unknown synthetic benchmark case: ${item.id}`);
  }
}

function validate(item, result) {
  const expected = item.expected;
  switch (item.id) {
    case 'api-payload':
      return result.status === expected.status && expected.requiredBodyKeys.every((key) => result.bodyKeys.includes(key));
    case 'queue-scheduler':
      return JSON.stringify(result.eligibleOrder) === JSON.stringify(expected.eligibleOrder)
        && result.excludedCount === expected.excludedCount;
    case 'memory-ranking':
      return result.topRelevant === expected.topRelevant && result.resultCount === expected.resultCount;
    case 'inference-fixture':
      return result.grounded === expected.grounded && result.answer.includes(expected.requiredPhrase);
    case 'media-metadata':
      return result.durationMs === expected.durationMs && result.sampleRate === expected.sampleRate
        && result.channels === expected.channels;
    case 'comms-approval':
      return result.status === expected.status && result.dispatchCount === expected.dispatchCount;
    default:
      return false;
  }
}

export async function runSyntheticBenchmark({ iterations = 100, warmup = 10, commitSha = process.env.GITHUB_SHA ?? 'UNPINNED' } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('iterations must be an integer from 1 to 10000');
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 1000) throw new Error('warmup must be an integer from 0 to 1000');

  const raw = await readFile(FIXTURE_PATH, 'utf8');
  const fixture = JSON.parse(raw);
  if (fixture.syntheticOnly !== true || fixture.providerCalls !== 0 || fixture.productionData !== false) {
    throw new Error('Benchmark fixture must remain synthetic-only, provider-free and production-data-free');
  }
  const fixtureSha256 = sha256(raw);
  const components = [];

  for (const item of fixture.cases) {
    for (let index = 0; index < warmup; index += 1) {
      if (!validate(item, executeFixture(item))) throw new Error(`Warmup correctness failure: ${item.id}`);
    }
    const samples = [];
    const heapBefore = process.memoryUsage().heapUsed;
    let failures = 0;
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      try {
        if (!validate(item, executeFixture(item))) failures += 1;
      } catch {
        failures += 1;
      } finally {
        samples.push(performance.now() - started);
      }
    }
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    samples.sort((a, b) => a - b);
    const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
    const elapsedMs = samples.reduce((sum, sample) => sum + sample, 0);
    components.push({
      caseId: item.id,
      component: item.component,
      iterations,
      failures,
      failureRate: failures / iterations,
      qualityPassRate: (iterations - failures) / iterations,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), mean: elapsedMs / iterations },
      throughputPerSecond: elapsedMs > 0 ? iterations / (elapsedMs / 1000) : null,
      heapDeltaBytes
    });
  }

  return {
    schemaVersion: '1.0.0',
    benchmark: 'ryanai-synthetic-component-baseline',
    mode: 'synthetic-fixtures-only',
    commitSha,
    fixture: { dataset: fixture.dataset, sha256: fixtureSha256, cases: fixture.cases.length },
    settings: { iterations, warmup },
    safety: { modelInvocation: false, providerCalls: 0, productionData: false, outboundDispatch: false },
    overall: {
      cases: components.length,
      totalIterations: components.reduce((sum, row) => sum + row.iterations, 0),
      failures: components.reduce((sum, row) => sum + row.failures, 0),
      qualityPassRate: components.reduce((sum, row) => sum + row.qualityPassRate, 0) / components.length
    },
    components
  };
}

async function main() {
  const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 100);
  const warmup = Number(process.env.BENCHMARK_WARMUP ?? 10);
  const report = await runSyntheticBenchmark({ iterations, warmup });
  const json = JSON.stringify(report, null, 2);
  const output = process.env.BENCHMARK_OUTPUT;
  if (output) await writeFile(path.resolve(output), json + '\n');
  process.stdout.write(json + '\n');
  if (report.overall.failures > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

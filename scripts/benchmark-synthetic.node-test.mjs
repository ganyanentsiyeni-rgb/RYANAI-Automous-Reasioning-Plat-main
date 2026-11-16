import test from 'node:test';
import assert from 'node:assert/strict';
import { runSyntheticBenchmark } from './benchmark-synthetic.mjs';

test('synthetic benchmark covers independent components with repeatable fixture identity', async () => {
  const first = await runSyntheticBenchmark({ iterations: 5, warmup: 1, commitSha: 'test-sha' });
  const second = await runSyntheticBenchmark({ iterations: 5, warmup: 1, commitSha: 'test-sha' });
  assert.equal(first.fixture.sha256, second.fixture.sha256);
  assert.deepEqual(first.components.map((row) => row.caseId), second.components.map((row) => row.caseId));
  assert.equal(first.components.length, 6);
  assert.equal(first.overall.totalIterations, 30);
  assert.equal(first.overall.failures, 0);
  assert.equal(first.overall.qualityPassRate, 1);
  assert.equal(first.safety.modelInvocation, false);
  assert.equal(first.safety.providerCalls, 0);
  assert.equal(first.safety.productionData, false);
  assert.equal(first.safety.outboundDispatch, false);
  for (const row of first.components) {
    assert.equal(row.iterations, 5);
    assert.equal(row.failures, 0);
    assert.equal(row.qualityPassRate, 1);
    assert.ok(row.latencyMs.p50 >= 0);
    assert.ok(row.latencyMs.p99 >= row.latencyMs.p50);
    assert.ok(row.throughputPerSecond > 0);
  }
});

test('synthetic benchmark rejects invalid iteration settings', async () => {
  await assert.rejects(() => runSyntheticBenchmark({ iterations: 0 }), /iterations/);
  await assert.rejects(() => runSyntheticBenchmark({ iterations: 10001 }), /iterations/);
});

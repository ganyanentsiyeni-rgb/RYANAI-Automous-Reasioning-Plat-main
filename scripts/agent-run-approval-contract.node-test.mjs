import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const operations = readFileSync('src/agent/operations.ts', 'utf8');

test('AgentRun approval is fail-closed by default', () => {
  assert.match(schema, /approvalStatus String @default\("pending"\) @map\("approval_status"\)/);
  assert.match(
    operations,
    /requestedModel: requestedModel \?\? null, executionScope, traceContext: captureQueueTraceContextForStorage\(\), approvalStatus: 'pending', status: 'queued'/,
  );
  assert.match(
    operations,
    /userId: actorId, objective, executionScope, traceContext: captureQueueTraceContextForStorage\(\), approvalStatus: 'pending', status: 'queued'/,
  );
});

test('AgentRun worker requires explicit approved state', () => {
  assert.match(operations, /"approval_status" = 'approved'/);
  assert.match(operations, /approved_plan_hash/);
  assert.match(operations, /approved_commit_sha/);
  assert.match(operations, /approved_diff_hash/);
});

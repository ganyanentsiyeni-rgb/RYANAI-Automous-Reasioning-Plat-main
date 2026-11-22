import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const routes = readFileSync(resolve(root, 'src/server/routes/approvalRoutes.ts'), 'utf8');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(resolve(root, 'prisma/migrations/20261122200000_durable_approval_thread_binding/migration.sql'), 'utf8');
const notifications = readFileSync(resolve(root, 'src/utils/notifications.ts'), 'utf8');
const agentOperations = readFileSync(resolve(root, 'src/server/routes/agentOperations.ts'), 'utf8');

test('approval routes require a durable pending action before resume', () => {
  assert.match(routes, /pendingAction\.findFirst/);
  assert.match(routes, /status: 'pending'/);
  assert.match(routes, /status: 'BLOCKED'/);
  assert.match(routes, /decidedBy: request\.authUser!\.id/);
  assert.match(routes, /status: 'approved'/);
  assert.match(routes, /status: 'executed'/);
});

test('pending actions bind approvals to the authenticated thread', () => {
  assert.match(schema, /threadId\s+String\s+@map\("thread_id"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS thread_id/);
  assert.match(migration, /ALTER COLUMN thread_id SET NOT NULL/);
});

test('notification delivery is reported instead of being claimed blindly', () => {
  assert.match(notifications, /export interface ApprovalNotificationResult/);
  assert.match(notifications, /response\.ok/);
  assert.match(routes, /notification\.sent/);
});


test('ordinary AgentRuns have an explicit admin approval gate', () => {
  assert.match(agentOperations, /\/api\/agent\/ops\/approvals\/pending/);
  assert.match(agentOperations, /\/api\/agent\/ops\/tasks\/:id\/approve/);
  assert.match(agentOperations, /\/api\/agent\/ops\/tasks\/:id\/reject/);
  assert.match(agentOperations, /preHandler: requireAdmin/);
  assert.match(agentOperations, /approvalStatus: 'approved'/);
  assert.match(agentOperations, /approvedBy: adminId/);
  assert.match(agentOperations, /approvedAt: new Date\(\)/);
  assert.match(agentOperations, /approval\.approved/);
  assert.match(agentOperations, /approval\.rejected/);
});

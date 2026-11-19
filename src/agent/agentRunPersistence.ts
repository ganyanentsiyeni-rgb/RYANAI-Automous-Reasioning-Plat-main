import { createHash } from 'node:crypto';
import type { ExecutionPlan } from './executionPlanner.js';
import { appendRunEvidence } from './engineeringEvidence.js';
import type { Prisma } from '@prisma/client';
import type { BrainOutput } from './operationsCore.js';
import { assertPACompletionCapabilityReceipts, type PACapabilityReceipt } from './paCapabilityCompletion.js';

interface PersistableAgentRun {
  id: string;
  user_id: string;
  objective: string;
  attempts: number;
  worker_id: string;
  execution_scope: unknown;
  trace_context: unknown;
}
interface PersistableHandoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  input: string;
}

/** Persist actual provider outputs atomically; unavailable brains remain failed rather than being fabricated. */
export async function persistAgentRunCompletion(
  tx: Prisma.TransactionClient,
  run: PersistableAgentRun,
  handoffs: PersistableHandoff[],
  plan: { outputs: BrainOutput[]; synthesis: string; degraded: boolean; verification?: { verified: boolean; reason: string | null }; capabilityReceipts?: PACapabilityReceipt[] },
  executionPlan: ExecutionPlan,
): Promise<void> {
  // A PA delegation is complete only when every approved capability has a passed, evidence-backed handler receipt.
  assertPACompletionCapabilityReceipts(run.execution_scope, plan.capabilityReceipts ?? []);
  const outputByBrain = new Map(plan.outputs.map((item) => [item.brain, item]));
  for (const row of handoffs) {
    const output = row.toAgent === 'primary'
      ? outputByBrain.get('primary')
      : row.toAgent === 'secondary'
        ? outputByBrain.get('secondary')
        : row.toAgent === 'pa' || row.toAgent === 'alex' || row.toAgent === 'jarvis'
          ? outputByBrain.get('logic') ?? outputByBrain.get('primary')
          : outputByBrain.get(row.fromAgent as 'primary' | 'secondary');
    const logicOutput = outputByBrain.get('logic');
    if (!output || (row.toAgent === 'logic' && !logicOutput)) {
      await tx.agentHandoff.update({
        where: { id: row.id },
        data: { status: 'failed', error: 'Required brain unavailable; no output or consensus was fabricated.', completedAt: new Date() },
      });
      continue;
    }
    await tx.agentHandoff.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        output: row.toAgent === 'logic' ? plan.synthesis : output.output,
        input: row.toAgent === 'logic' ? output.output : row.input,
        error: null,
        completedAt: new Date(),
      },
    });
  }
  await tx.memoryVault.create({
    data: {
      userId: run.user_id,
      title: 'Autonomous task ' + run.id,
      content: 'Objective:\n' + run.objective + '\n\nExecution plan:\n' + JSON.stringify(executionPlan) + '\n\nResult:\n' + plan.synthesis,
      category: 'agent-task',
      tags: ['agent-run', 'autonomous', ...(plan.degraded ? ['degraded'] : [])],
    },
  });
  const completion = await tx.agentRun.updateMany({
    where: { id: run.id, status: 'running', workerId: run.worker_id, attempts: run.attempts, cancelRequestedAt: null },
    data: {
      status: 'completed',
      result: { synthesis: plan.synthesis, degraded: plan.degraded, executionPlan, brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })) },
      completedAt: new Date(),
      lockedAt: null,
      workerId: null,
    },
  });
  if (completion.count !== 1) throw new Error('Agent run lease was lost before completion; stale worker result was discarded.');
  const scope = run.execution_scope && typeof run.execution_scope === 'object' ? run.execution_scope as Record<string, unknown> : {};
  const paDelegationId = typeof scope.paDelegationId === 'string' ? scope.paDelegationId : null;
  if (paDelegationId) {
    const delegation = await tx.paDelegation.findUnique({ where: { id: paDelegationId }, select: { id: true, traceId: true } });
    if (delegation) {
      await tx.paDelegation.update({ where: { id: delegation.id }, data: { status: 'completed' } });
      await tx.paExecutionReceipt.upsert({
        where: { delegationId: delegation.id },
        create: {
          delegationId: delegation.id,
          agentRunId: run.id,
          traceId: delegation.traceId,
          attempt: run.attempts,
          status: 'completed',
          result: { synthesis: plan.synthesis, degraded: plan.degraded, verification: plan.verification ?? { verified: false, reason: 'Verification evidence was not supplied.' } },
        },
        update: {
          agentRunId: run.id,
          traceId: delegation.traceId,
          attempt: run.attempts,
          status: 'completed',
          result: { synthesis: plan.synthesis, degraded: plan.degraded, verification: plan.verification ?? { verified: false, reason: 'Verification evidence was not supplied.' } },
          error: null,
        },
      });
    }
  }
  await appendRunEvidence(tx, {
    runId: run.id,
    eventType: 'execution.completed',
    payload: {
      attempt: run.attempts,
      degraded: plan.degraded,
      executionPlan,
      brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })),
      synthesisSha256: createHash('sha256').update(plan.synthesis, 'utf8').digest('hex'),
      verificationStatus: plan.verification?.verified ? 'three_brain_complete' : 'degraded',
    },
  });
}

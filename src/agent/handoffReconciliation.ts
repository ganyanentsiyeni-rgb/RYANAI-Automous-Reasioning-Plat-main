export type HandoffBrain = 'primary' | 'secondary' | 'logic';

export function buildRunHandoffUpdateWhere(
  run: { id: string; worker_id: string; attempts: number },
  brain: HandoffBrain,
) {
  return {
    runId: run.id,
    run: { is: { status: 'running', workerId: run.worker_id, attempts: run.attempts } },
    ...(brain === 'logic'
      ? { toAgent: 'logic', status: { in: ['pending', 'running'] } }
      : { fromAgent: { in: ['supervisor', 'jarvis'] }, toAgent: brain }),
  };
}


import { createRyanAIStudioWorkerRuntime } from '../src/server/engineering/ryanaiStudioWorkerRuntime.js';
import {
  getStudioWorkerHandlerReadiness,
  registerStudioTaskHandler,
} from '../src/server/engineering/studioNativeCore.js';
import { analyzeRyanAICiEvidence, createRyanAICiProviderBlockedReport } from '../src/server/engineering/ryanaiCiDiagnostics.js';
import { generateRepositoryInventory } from './repository-inventory.mjs';
import { prisma } from '../src/lib/prisma.js';
import { inspectConnectedGitHubWorkflowEvidence } from '../src/server/routes/githubIntegration.js';

const profileId = process.env.RYANAI_STUDIO_WORKER_PROFILE_ID?.trim() || 'coordinator';
const workerId = process.env.RYANAI_STUDIO_WORKER_ID?.trim();

const runRepositoryInventoryTask = async ({ task }: {
  task: { id: string; objective: string; requiredCapabilities: string[] };
}) => {
  if (!task.requiredCapabilities.includes('read-repository')) {
    throw new Error('Repository inventory requires the explicit read-repository capability.');
  }
  return {
    kind: 'repository.inventory',
    schemaVersion: 1,
    taskId: task.id,
    objective: task.objective,
    inventory: await generateRepositoryInventory(),
  };
};

const runCiDiagnosticsTask = async ({ task }: {
  task: { input: unknown; requiredCapabilities: string[]; ownerUserId: string };
}) => {
  if (!task.requiredCapabilities.includes('read-workflow-runs')) {
    throw new Error('CI diagnostics requires the explicit read-workflow-runs capability.');
  }
  const input = task.input !== null && typeof task.input === 'object' && !Array.isArray(task.input)
    ? task.input as Record<string, unknown>
    : {};
  const requestedHeadSha = typeof input.headSha === 'string' ? input.headSha : '';

  try {
    const evidence = await inspectConnectedGitHubWorkflowEvidence(
      { prisma },
      task.ownerUserId,
      requestedHeadSha,
      { includeJobLogs: task.requiredCapabilities.includes('read-job-logs') },
    );
    const report = analyzeRyanAICiEvidence({
      headSha: evidence.verifiedHeadSha,
      workflowRuns: evidence.workflowRuns.map((run) => ({
        id: run.id,
        name: run.name,
        headSha: run.headSha,
        status: run.status,
        conclusion: run.conclusion,
        url: run.url,
      })),
      jobLogs: evidence.jobLogExcerpts,
    }, task.requiredCapabilities);

    return {
      ...report,
      source: evidence.source,
      repositoryFullName: evidence.repositoryFullName,
      requestedHeadSha: evidence.requestedHeadSha,
      verifiedHeadSha: evidence.verifiedHeadSha,
      inspectedAt: evidence.inspectedAt,
      snapshotComplete: evidence.complete,
      jobLogRetrievalStatus: evidence.jobLogStatus,
      liveProviderFetchPerformed: true,
      jobs: evidence.workflowRuns.map((run) => ({
        runId: run.id,
        workflow: run.name,
        jobs: run.jobs,
      })),
      notes: [
        ...report.notes,
        'Workflow run and job metadata were fetched read-only from the owner-bound GitHub connection.',
        evidence.jobLogStatus === 'not_requested'
          ? 'Job logs were not requested; the read-job-logs capability was not present.'
          : 'Job-log retrieval status: ' + evidence.jobLogStatus + '. Raw log text is never included in this report.',
      ],
    };
  } catch (error) {
    return createRyanAICiProviderBlockedReport(
      /^[a-f0-9]{40}$/i.test(requestedHeadSha) ? requestedHeadSha.toLowerCase() : null,
      error,
    );
  }
};

// Handlers are registered only for the selected specialist profile. Both
// adapters are read-only and require their declared capability at admission.
const unregisterHandlers = profileId === 'repository-auditor'
  ? [
      registerStudioTaskHandler('repository-audit', runRepositoryInventoryTask),
      registerStudioTaskHandler('inventory', runRepositoryInventoryTask),
    ]
  : profileId === 'ci-diagnostics'
    ? [
        registerStudioTaskHandler('ci-failure', runCiDiagnosticsTask),
        registerStudioTaskHandler('test-failure', runCiDiagnosticsTask),
        registerStudioTaskHandler('build-failure', runCiDiagnosticsTask),
      ]
    : [];

const handlerReadiness = getStudioWorkerHandlerReadiness(profileId);
if (!handlerReadiness.ready) {
  for (const unregister of unregisterHandlers) unregister();
  throw new Error(
    `RyanAI Studio worker ${profileId} cannot start: ${handlerReadiness.reason} Supported task types: ${handlerReadiness.supportedTaskTypes.join(', ')}.`,
  );
}

const runtime = createRyanAIStudioWorkerRuntime({
  workerProfileId: profileId,
  workerInstanceId: workerId,
  pollIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_POLL_MS ?? 1000),
  heartbeatIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_HEARTBEAT_MS ?? 5000),
  recoveryIntervalMs: Number(process.env.RYANAI_STUDIO_WORKER_RECOVERY_MS ?? 15000),
  leaseSeconds: Number(process.env.RYANAI_STUDIO_WORKER_LEASE_SECONDS ?? 90),
});

const shutdown = async () => {
  await runtime.stop();
  for (const unregister of unregisterHandlers) unregister();
  process.exit(0);
};

process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });

await runtime.start();
console.log(JSON.stringify({
  service: 'ryanai-native-studio-worker',
  workerId: runtime.snapshot().workerId,
  workerProfileId: profileId,
  registeredTaskTypes: handlerReadiness.registeredTaskTypes,
  status: runtime.snapshot().status,
}));

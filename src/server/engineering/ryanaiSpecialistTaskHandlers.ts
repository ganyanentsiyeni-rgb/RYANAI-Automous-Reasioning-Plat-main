import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StudioWorkerContext } from './studioNativeCore.js';
import { registerStudioTaskHandler } from './studioNativeCore.js';

const execFileAsync = promisify(execFile);

type AuditRule = { id: string; severity: 'high' | 'medium' | 'review'; pattern: RegExp; message: string };
type AuditSpec = { capability: string; title: string; files: readonly string[]; rules: readonly AuditRule[] };

const SPECS: Record<string, AuditSpec> = {
  'security-auditor': {
    capability: 'read-security-results', title: 'Security and dependency inspection',
    files: ['package.json', 'package-lock.json', 'Dockerfile', 'Dockerfile.api', '.github/workflows/ci-cd.yml', '.github/workflows/security.yml'],
    rules: [
      { id: 'TLS-VERIFY-DISABLED', severity: 'high', pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*['"]?0/i, message: 'TLS certificate verification appears disabled in tracked configuration.' },
      { id: 'SHELL-CURL-PIPE', severity: 'review', pattern: /curl[^\n|]*\|\s*(?:sh|bash)/i, message: 'A network-fetched script may be piped directly to a shell.' },
      { id: 'PERMISSIVE-WORKFLOW-PERMISSIONS', severity: 'review', pattern: /permissions:\s*write-all/i, message: 'A workflow requests broad write-all permissions.' },
      { id: 'TRACKED-SECRET-LIKE-VALUE', severity: 'high', pattern: /(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i, message: 'A tracked file contains a secret-like literal; value intentionally withheld.' },
    ],
  },
  'runtime-infrastructure': {
    capability: 'read-runtime-config', title: 'Runtime and infrastructure inspection',
    files: ['render.yaml', 'railway.json', 'railway.toml', 'vercel.json', 'Dockerfile', 'Dockerfile.api', 'docker-compose.yml', 'docker-compose.yaml'],
    rules: [
      { id: 'TLS-VERIFY-DISABLED', severity: 'high', pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*['"]?0/i, message: 'TLS verification disablement detected.' },
      { id: 'RUNTIME-MIGRATION-ON-START', severity: 'review', pattern: /(?:prisma\s+migrate\s+deploy|db:migrate)/i, message: 'A runtime startup descriptor may run schema migrations; verify migration separation.' },
      { id: 'MISSING-HEALTH-CHECK', severity: 'review', pattern: /healthCheckPath|healthcheck|health_check/i, message: 'A health-check declaration is present; validate its target and runtime behavior.' },
    ],
  },
  'data-queue': {
    capability: 'read-schema', title: 'Database and queue contract inspection',
    files: ['prisma/schema.prisma', 'prisma/audiobook/schema.prisma', 'src/server/engineering/studioNativeCore.ts', 'src/server/engineering/ryanaiStudioWorkerRuntime.ts'],
    rules: [
      { id: 'LEASE-FENCING', severity: 'review', pattern: /leaseToken|lease_token/i, message: 'Lease-token fencing is represented in the inspected source; confirm integration tests exercise stale-lease rejection.' },
      { id: 'IDEMPOTENCY', severity: 'review', pattern: /idempotency/i, message: 'Idempotency controls are represented in the inspected source; confirm collision and retry tests.' },
      { id: 'QUEUE-RETRY', severity: 'review', pattern: /maxAttempts|availableAt|recoverExpired/i, message: 'Queue retry or recovery logic is present; confirm bounded backoff and recovery evidence.' },
    ],
  },
  'provider-verification': {
    capability: 'read-provider-config-presence', title: 'Inference provider configuration inspection',
    files: ['src/server', 'src/agent'],
    rules: [
      { id: 'PROVIDER-PROBE-REQUIRED', severity: 'review', pattern: /HEALTHY|healthCheck|probe/i, message: 'Provider health probe logic is present in inspected code; static presence does not prove live authentication or availability.' },
    ],
  },
  communications: {
    capability: 'read-integration-config', title: 'Communications and identity inspection',
    files: ['src/server/comms', 'src/server/routes', 'src/agent'],
    rules: [
      { id: 'CONSENT-CONTROL', severity: 'review', pattern: /consent|opt.?in|opt.?out/i, message: 'Consent-related controls are present; verify owner scope and channel-specific enforcement.' },
      { id: 'CALLBACK-VERIFICATION', severity: 'review', pattern: /callback|webhook|signature/i, message: 'Callback or webhook handling is present; verify provider signature and destination ownership checks.' },
      { id: 'OUTBOUND-CHANNEL', severity: 'review', pattern: /sendMessage|messages\.create|\.messages\.create|sendMail|sendEmail/i, message: 'Outbound communication code is present; verify explicit authorization and provider callback evidence.' },
    ],
  },
  'frontend-accessibility': {
    capability: 'read-frontend-source', title: 'Frontend and accessibility inspection',
    files: ['src/components', 'src/pages', 'src/app'],
    rules: [
      { id: 'IMAGE-ALT', severity: 'review', pattern: /<img\b(?![^>]*\balt=)/i, message: 'An image element may be missing alternative text.' },
      { id: 'CLICKABLE-NONBUTTON', severity: 'review', pattern: /<div[^>]+onClick=/i, message: 'A clickable div may require keyboard semantics or a native button.' },
      { id: 'AUTOFOCUS', severity: 'review', pattern: /autoFocus/i, message: 'Autofocus usage should be checked for assistive-technology impact.' },
    ],
  },
  'release-readiness': {
    capability: 'read-readiness-evidence', title: 'Documentation and release readiness inspection',
    files: ['README.md', 'patches.md', 'architecture.md', 'docs/ARCHITECTURE.md', '.github/workflows'],
    rules: [
      { id: 'DEPLOYMENT-GATE-DOCS', severity: 'review', pattern: /PUSH DEPLOY|exact.SHA|exact.head/i, message: 'Deployment gating is documented; verify implementation and current workflow evidence.' },
      { id: 'HUMAN-REVIEW-DOCS', severity: 'review', pattern: /human review|human approval/i, message: 'Human review is documented; verify branch protection and required checks enforce it.' },
    ],
  },
};

async function collectAllowedEvidence(relativePath: string, signal?: AbortSignal, depth = 0): Promise<Array<{ path: string; content: string }>> {
  signal?.throwIfAborted();
  const resolved = path.resolve(process.cwd(), relativePath);
  const root = path.resolve(process.cwd()) + path.sep;
  if (!resolved.startsWith(root)) throw new Error('Evidence path escaped the repository root.');
  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    if (depth > 4) return [];
    const output: Array<{ path: string; content: string }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted();
      if (entry.name.startsWith('.') || /^(node_modules|dist|build|coverage|\.git|\.next)$/i.test(entry.name)) continue;
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        output.push(...await collectAllowedEvidence(child, signal, depth + 1));
      } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|prisma|md)$/i.test(entry.name)) {
        const content = await readFile(path.resolve(process.cwd(), child), 'utf8');
        output.push({ path: child, content });
      }
      if (output.length >= 100) return output.slice(0, 100);
    }
    return output;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOTDIR') {
      try {
        const content = await readFile(resolved, 'utf8');
        return [{ path: relativePath, content }];
      } catch (readError) {
        if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT') return [];
        throw readError;
      }
    }
    throw error;
  }
}

function findRuleEvidence(spec: AuditSpec, files: Array<{ path: string; content: string }>) {
  const findings: Array<{ id: string; severity: string; message: string; evidenceFiles: string[] }> = [];
  for (const rule of spec.rules) {
    const matched = files.filter((file) => rule.pattern.test(file.content)).map((file) => file.path);
    if (matched.length) findings.push({ id: rule.id, severity: rule.severity, message: rule.message, evidenceFiles: matched });
  }
  return findings;
}

async function runStaticInspection(profileId: string, context: StudioWorkerContext) {
  const spec = SPECS[profileId];
  if (!spec) throw new Error('No static inspection specification exists for this worker.');
  if (!context.task.requiredCapabilities.includes(spec.capability)) {
    throw new Error(profileId + ' requires the explicit ' + spec.capability + ' capability.');
  }
  const files: Array<{ path: string; content: string }> = [];
  const missing: string[] = [];
  for (const file of spec.files) {
    const evidence = await collectAllowedEvidence(file, context.signal);
    if (evidence.length === 0) missing.push(file);
    else files.push(...evidence);
  }
  const findings = findRuleEvidence(spec, files);
  return {
    schemaVersion: 1,
    kind: 'ryanai.specialist-inspection',
    workerProfileId: profileId,
    taskId: context.task.id,
    title: spec.title,
    inspectedAt: new Date().toISOString(),
    evidenceFiles: files.map((file) => file.path),
    missingEvidencePaths: missing,
    findings,
    summary: files.length
      ? 'Static source inspection completed. Findings are indicators for human review, not proof of runtime health.'
      : 'No configured evidence files were available; this inspection is incomplete.',
    runtimeVerification: 'not_performed',
    externalActions: 'none',
  };
}

async function runCoordinator(context: StudioWorkerContext) {
  if (!context.task.requiredCapabilities.includes('read-task')) throw new Error('Coordinator requires the explicit read-task capability.');
  const objective = context.task.objective.trim();
  return {
    schemaVersion: 1, kind: 'ryanai.coordination.plan', taskId: context.task.id,
    objective, assignedWorkerId: context.task.assignedWorkerId ?? null,
    steps: ['Confirm objective and owner scope', 'Identify a registered specialist and required evidence', 'Collect exact task and test evidence', 'Return findings and unresolved blockers to PA'],
    status: 'plan_proposed', executionAuthority: 'none',
  };
}

async function runAIInspector(context: StudioWorkerContext) {
  if (!context.task.requiredCapabilities.includes('read-repository')) throw new Error('AI Inspector requires the explicit read-repository capability.');
  context.signal?.throwIfAborted();
  const script = path.resolve(process.cwd(), 'scripts/ai-inspector-audit.mjs');
  try {
    const result = await (execFileAsync as unknown as (file: string, args: string[], options: object) => Promise<{ stdout: string; stderr: string }>)(
      process.execPath, [script], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, signal: context.signal },
    );
    return { schemaVersion: 1, kind: 'ryanai.ai-inspector.report', taskId: context.task.id, report: result.stdout, stderr: result.stderr, reportSource: 'scripts/ai-inspector-audit.mjs', persistedBy: 'studio-task-output', externalActions: 'none' };
  } catch (error) {
    context.signal?.throwIfAborted();
    const value = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown };
    if (typeof value.stdout === 'string') {
      return { schemaVersion: 1, kind: 'ryanai.ai-inspector.report', taskId: context.task.id, report: value.stdout, stderr: typeof value.stderr === 'string' ? value.stderr : '', exitCode: typeof value.code === 'number' ? value.code : 1, reportSource: 'scripts/ai-inspector-audit.mjs', persistedBy: 'studio-task-output', externalActions: 'none' };
    }
    throw error;
  }
}

export function registerRyanAISpecialistTaskHandlers(profileId: string) {
  const unregister: Array<() => void> = [];
  const add = (taskType: string, handler: (context: StudioWorkerContext) => Promise<unknown>) => {
    unregister.push(registerStudioTaskHandler(taskType, handler));
  };
  if (profileId === 'coordinator') {
    for (const type of ['planning', 'triage', 'coordination']) add(type, runCoordinator);
  } else if (profileId === 'repository-auditor') {
    add('documentation-audit', (context) => runStaticInspection('release-readiness', context));
    add('ai-inspector.audit', runAIInspector);
    add('ai-inspector.report', runAIInspector);
  } else if (SPECS[profileId]) {
    const handler = (context: StudioWorkerContext) => runStaticInspection(profileId, context);
    const profileTaskTypes: Record<string, string[]> = {
      'security-auditor': ['security-audit', 'dependency-audit', 'container-audit'],
      'runtime-infrastructure': ['runtime-audit', 'infrastructure-audit', 'health-check'],
      'data-queue': ['database-audit', 'queue-audit', 'worker-recovery'],
      'provider-verification': ['provider-audit', 'brain-health', 'inference-verification'],
      communications: ['communications-audit', 'identity-audit', 'localization-audit'],
      'frontend-accessibility': ['frontend-audit', 'accessibility-audit', 'ui-regression'],
      'release-readiness': ['release-audit', 'documentation', 'readiness-review'],
    };
    for (const type of profileTaskTypes[profileId] ?? []) add(type, handler);
  }
  return () => { for (const remove of unregister.reverse()) remove(); };
}

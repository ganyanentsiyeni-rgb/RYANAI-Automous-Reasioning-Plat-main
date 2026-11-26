import { useRyanOperations } from '@/hooks/useRyanOperations';

type EvidenceRecord = {
  id?: unknown;
  sequence?: unknown;
  eventType?: unknown;
  createdAt?: unknown;
  payload?: unknown;
};

type InspectorReport = {
  evidenceId: string;
  sequence: number | null;
  recordedAt: string | null;
  report: string;
  reportSource: string;
  reportDigest: string;
  exitCode: 0 | 1;
  findings: Array<{ id: string; severity: string; message: string; evidenceFiles: string[] }>;
};

function recordInspectorReport(value: unknown): InspectorReport | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as EvidenceRecord;
  if (record.eventType !== 'pa.capability.executed' || !record.payload || typeof record.payload !== 'object') return null;
  const payload = record.payload as Record<string, unknown>;
  if (payload.capability !== 'ai-inspector.inspect') return null;
  if (typeof record.id !== 'string' || typeof payload.report !== 'string'
    || typeof payload.reportSource !== 'string'
    || typeof payload.reportDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.reportDigest)
    || (payload.reportExitCode !== 0 && payload.reportExitCode !== 1)) return null;
  if (!Array.isArray(payload.findings)) return null;
  const findings: Array<{ id: string; severity: string; message: string; evidenceFiles: string[] }> = [];
  for (const item of payload.findings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const finding = item as Record<string, unknown>;
    if (typeof finding.id !== 'string' || typeof finding.severity !== 'string'
      || typeof finding.message !== 'string'
      || (finding.evidenceFiles !== undefined
        && (!Array.isArray(finding.evidenceFiles) || !finding.evidenceFiles.every((path) => typeof path === 'string')))) return null;
    findings.push({
      id: finding.id, severity: finding.severity, message: finding.message,
      evidenceFiles: Array.isArray(finding.evidenceFiles) ? finding.evidenceFiles as string[] : [],
    });
  }
  return {
    evidenceId: record.id,
    sequence: typeof record.sequence === 'number' ? record.sequence : null,
    recordedAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    report: payload.report,
    reportSource: payload.reportSource,
    reportDigest: payload.reportDigest,
    exitCode: payload.reportExitCode,
    findings,
  };
}

function taskEvidence(task: unknown): EvidenceRecord[] {
  if (!task || typeof task !== 'object') return [];
  const evidence = (task as { evidence?: unknown }).evidence;
  return Array.isArray(evidence) ? evidence as EvidenceRecord[] : [];
}

/** Read-only view of durable AI Inspector evidence returned with authenticated AgentRuns. */
export default function AIInspectorEvidencePanel() {
  const { tasks, loading, error, lastConfirmedAt, refresh, refreshing } = useRyanOperations();
  const inspectorTasks = tasks.filter((task) =>
    /ai[\s_-]*inspector/i.test(task.objective ?? '')
    || taskEvidence(task).some((event) => event.eventType === 'pa.capability.executed'
      && !!event.payload && typeof event.payload === 'object'
      && (event.payload as Record<string, unknown>).capability === 'ai-inspector.inspect'),
  );

  return (
    <section aria-labelledby="ai-inspector-evidence-title" className="rounded-2xl border border-violet-300/20 bg-slate-950/70 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300">Durable audit evidence</p>
          <h3 id="ai-inspector-evidence-title" className="mt-1 text-lg font-semibold text-white">AI Inspector reports</h3>
          <p className="mt-1 text-xs text-slate-500">
            {lastConfirmedAt ? `AgentRun snapshot confirmed ${new Date(lastConfirmedAt).toLocaleString()}` : 'Awaiting an authenticated AgentRun snapshot'}
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">
          {refreshing ? 'Refreshing…' : 'Refresh reports'}
        </button>
      </header>

      {error && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">Some operational sources are unavailable: {error}</p>}
      {loading && inspectorTasks.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-xs text-slate-400">Loading authenticated AgentRun evidence…</p>
      ) : inspectorTasks.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-xs text-slate-400">No AI Inspector task or report evidence was returned in the latest AgentRun window. This does not establish that no earlier audit exists.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {inspectorTasks.map((task) => {
            const events = taskEvidence(task).filter((event) => event.eventType === 'pa.capability.executed'
              && !!event.payload && typeof event.payload === 'object'
              && (event.payload as Record<string, unknown>).capability === 'ai-inspector.inspect');
            const parsed = events.map(recordInspectorReport);
            const reports = parsed.filter((item): item is InspectorReport => item !== null);
            const malformed = events.length > reports.length;
            const taskStatus = String(task.status ?? 'unreported');
            return (
              <li key={task.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">{task.objective || task.id}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500">AgentRun {task.id}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-300">AgentRun: {taskStatus}</span>
                </div>
                {malformed && <p role="alert" className="mt-3 text-xs text-amber-200">An Inspector evidence event exists but its report contract is incomplete or malformed. It is not treated as a valid report.</p>}
                {reports.length === 0 && !malformed && <p className="mt-3 text-xs text-slate-400">No persisted Inspector report evidence is attached to this AgentRun yet.</p>}
                {reports.map((report) => (
                  <article key={report.evidenceId} className="mt-3 border-t border-white/10 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-violet-200">
                        {taskStatus === 'completed'
                          ? report.exitCode === 1 ? 'Completed — findings reported' : 'Completed — exit code 0'
                          : `Report recorded — AgentRun ${taskStatus}`}
                      </span>
                      <span className="text-[10px] text-slate-500">Inspector exit code {report.exitCode}</span>
                    </div>
                    {report.findings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {report.findings.map((finding) => (
                          <li key={finding.id} className="rounded-md bg-white/[0.03] p-2 text-xs text-slate-300">
                            <span className="font-semibold text-amber-200">[{finding.severity.toUpperCase()}] {finding.id}</span>
                            <p className="mt-1">{finding.message}</p>
                            {finding.evidenceFiles.length > 0 && <p className="mt-1 break-all text-[10px] text-slate-500">Evidence: {finding.evidenceFiles.join(', ')}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-violet-200">View persisted report</summary>
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-[10px] leading-5 text-slate-300">{report.report}</pre>
                    </details>
                    <dl className="mt-2 grid gap-1 text-[10px] text-slate-500 sm:grid-cols-2">
                      <div><dt className="inline">Source: </dt><dd className="inline break-all">{report.reportSource}</dd></div>
                      <div><dt className="inline">Evidence event: </dt><dd className="inline break-all">{report.evidenceId}{report.sequence !== null ? ` · sequence ${report.sequence}` : ''}</dd></div>
                      {report.recordedAt && <div><dt className="inline">Recorded: </dt><dd className="inline">{new Date(report.recordedAt).toLocaleString()}</dd></div>}
                      <div className="sm:col-span-2"><dt className="inline">SHA-256 recorded: </dt><dd className="inline break-all">{report.reportDigest}</dd></div>
                    </dl>
                    <p className="mt-2 text-[10px] text-slate-500">The recorded digest is displayed as supplied by the backend; this panel does not independently verify the evidence hash chain or certify runtime health. Exit code 0 is not a clean-audit certification.</p>
                  </article>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 border-t border-white/10 pt-3 text-[10px] text-slate-500">Read-only. Reports are loaded from the authenticated AgentRun list and its persisted evidence events; this panel cannot start audits, approve work, or execute remediations.</p>
    </section>
  );
}

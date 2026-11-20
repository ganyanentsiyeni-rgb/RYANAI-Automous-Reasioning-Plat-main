import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface BackupInventory {
  status: 'available' | 'not_configured' | 'unavailable';
  bucket: string | null;
  retentionDays: number;
  listedAt: string;
  hasMore: boolean;
  reason?: string;
  items: Array<{
    backupId: string;
    prefix: string;
    createdAt: string | null;
    databaseBytes: number | null;
    databaseSha256: string | null;
    manifestPresent: boolean;
    retention: 'within_policy' | 'outside_policy' | 'unknown';
  }>;
}

interface MaintenanceRecord {
  id: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  status: 'requested' | 'closed';
  requestedAt: string;
}

interface ResilienceStatus {
  generatedAt: string;
  online: boolean;
  backup: {
    status: 'ready' | 'not_configured' | 'unavailable';
    databaseConfigured: boolean;
    storageConfigured: boolean;
    destinationBucket: string | null;
    pgDumpAvailable: boolean;
    reason?: string;
  };
  recovery: {
    status: string;
    productionRestore: string;
    targetLabel: string | null;
    writesPerformed: false;
    reason?: string;
  };
  selfPatch: { status: string; mode: string };
  maintenance: { status: string; automation: string };
}

export default function ResiliencePanel({ userId }: { userId: string }) {
  const [status, setStatus] = useState<ResilienceStatus | null>(null);
  const [inventory, setInventory] = useState<BackupInventory | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, inventoryResponse, maintenanceResponse] = await Promise.all([
        authenticatedFetch('/api/admin/resilience/status', { headers: { Accept: 'application/json' } }, userId),
        authenticatedFetch('/api/admin/resilience/backups', { headers: { Accept: 'application/json' } }, userId),
        authenticatedFetch('/api/admin/resilience/maintenance', { headers: { Accept: 'application/json' } }, userId),
      ]);
      const statusPayload = await statusResponse.json() as ResilienceStatus & { error?: string };
      const inventoryPayload = await inventoryResponse.json() as BackupInventory;
      const maintenancePayload = await maintenanceResponse.json() as { records?: MaintenanceRecord[]; error?: string };
      if (!statusResponse.ok) throw new Error(statusPayload.error || 'Resilience status unavailable.');
      if (!inventoryResponse.ok) throw new Error(inventoryPayload.reason || 'Backup inventory unavailable.');
      if (!maintenanceResponse.ok) throw new Error(maintenancePayload.error || 'Maintenance history unavailable.');
      setStatus(statusPayload);
      setInventory(inventoryPayload);
      setMaintenance(maintenancePayload.records || []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Resilience status unavailable.');
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runBackup() {
    if (busy || !window.confirm('Start a database backup now? This creates a new backup artifact and does not modify production data.')) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const response = await authenticatedFetch('/api/admin/resilience/backups', { method: 'POST' }, userId);
      const payload = await response.json() as { result?: { reason?: string; backupId?: string } };
      if (!response.ok) throw new Error(payload.result?.reason || 'Backup request failed (' + response.status + ').');
      setNotice('Backup completed: ' + (payload.result?.backupId || 'receipt recorded') + '.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/admin/resilience/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() }),
      }, userId);
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Maintenance request failed.');
      setReason('');
      setStartsAt('');
      setEndsAt('');
      setNotice('Maintenance window request recorded. No services were changed or paused.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Maintenance request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function closeMaintenance(id: string) {
    if (busy || !window.confirm('Close this maintenance record? This only records its lifecycle status; it does not change infrastructure.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/admin/resilience/maintenance/' + encodeURIComponent(id) + '/close', { method: 'POST' }, userId);
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not close maintenance record.');
      setNotice('Maintenance record closed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close maintenance record.');
    } finally {
      setBusy(false);
    }
  }


  const tone = status?.backup.status === 'ready' ? 'text-emerald-300' : 'text-amber-200';

  return (
    <section aria-labelledby="resilience-heading" className="mx-auto my-6 max-w-6xl rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100">
      <header className="mb-5 flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-cyan-300" />
        <div>
          <h2 id="resilience-heading" className="font-semibold">Resilience, Recovery &amp; Maintenance</h2>
          <p className="text-xs text-slate-400">Operational state is evidence-based; unavailable and unverified are not shown as healthy.</p>
        </div>
        <button onClick={() => void refresh()} className="ml-auto rounded-lg border border-slate-700 p-2" aria-label="Refresh resilience status"><RefreshCw className="h-4 w-4" /></button>
      </header>

      {error && <p role="alert" className="mb-4 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mb-4 text-sm text-emerald-300">{notice}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5" /><h3 className="font-medium">Backup management</h3></div>
          <p className={'mt-2 text-sm ' + tone}>Status: {status?.backup.status || 'unknown'}</p>
          <p className="mt-1 text-xs text-slate-400">PostgreSQL: {status?.backup.databaseConfigured ? 'configured' : 'not configured'} · pg_dump: {status?.backup.pgDumpAvailable ? 'available' : 'unavailable'}</p>
          <p className="mt-1 text-xs text-slate-400">Private destination: {status?.backup.destinationBucket || 'not configured'}</p>
          {status?.backup.reason && <p className="mt-2 text-xs text-amber-200">{status.backup.reason}</p>}
          <button disabled={busy || status?.backup.status !== 'ready'} onClick={() => void runBackup()} className="mt-4 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold disabled:opacity-40">
            {busy ? 'Working…' : 'Run database backup'}
          </button>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /><h3 className="font-medium">Disaster recovery</h3></div>
          <p className="mt-2 text-sm">Recovery drill target: {status?.recovery.targetLabel || 'not configured'}</p>
          <p className="mt-1 text-xs text-slate-400">Target validation: {status?.recovery.status || 'unknown'}</p>
          <p className="mt-1 text-xs text-slate-400">Production restore: {status?.recovery.productionRestore} · writes performed: {String(status?.recovery.writesPerformed ?? false)}</p>
          {status?.recovery.reason && <p className="mt-1 text-xs text-amber-200">{status.recovery.reason}</p>}
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="font-medium">Backup inventory &amp; retention preview</h3>
          <p className="mt-1 text-xs text-slate-400">{inventory?.items.length ?? 0} artifacts · policy window {inventory?.retentionDays ?? 'unknown'} days · preview only</p>
          {inventory?.reason && <p className="mt-2 text-xs text-amber-200">{inventory.reason}</p>}
          <ul className="mt-3 space-y-2">
            {inventory?.items.slice(0, 10).map((item) => (
              <li key={item.prefix} className="rounded-lg border border-slate-800 p-2 text-xs">
                <div className="flex justify-between gap-2"><span>{item.backupId}</span><span>{item.retention.replace('_', ' ')}</span></div>
                <p className="mt-1 text-slate-400">{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Timestamp unknown'} · {item.databaseBytes == null ? 'Size unknown' : item.databaseBytes.toLocaleString() + ' bytes'}</p>
                <p className="break-all text-slate-500">SHA-256: {item.databaseSha256 || 'unavailable'} · manifest {item.manifestPresent ? 'present' : 'missing/unreadable'}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-200">No backup objects are deleted or modified by this panel.</p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5" /><h3 className="font-medium">Self-patching</h3></div>
          <p className="mt-2 text-sm">Status: {status?.selfPatch.status || 'unknown'}</p>
          <p className="mt-1 text-xs text-slate-400">Mode: isolated GitHub PR; merge and deployment remain separate.</p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:col-span-2">
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5" /><h3 className="font-medium">Maintenance windows</h3></div>
          <p className="mt-1 text-xs text-slate-400">Requests are durably audited. This lifecycle does not pause services, deploy code or alter infrastructure.</p>
          <form onSubmit={(event) => void requestMaintenance(event)} className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-300 md:col-span-2">Reason
              <textarea required minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-300">Start
              <input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-300">End
              <input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
            <button disabled={busy || !reason.trim() || !startsAt || !endsAt} className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold disabled:opacity-40 md:col-span-2">Record maintenance request</button>
          </form>
          <ul className="mt-4 space-y-2">
            {maintenance.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-800 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.reason}</strong><span className="text-xs text-slate-400">{item.status}</span></div>
                <p className="mt-1 text-xs text-slate-400">{new Date(item.startsAt).toLocaleString()} – {new Date(item.endsAt).toLocaleString()}</p>
                {item.status === 'requested' && <button disabled={busy} onClick={() => void closeMaintenance(item.id)} className="mt-2 rounded border border-slate-700 px-2 py-1 text-xs">Close record</button>}
              </li>
            ))}
            {maintenance.length === 0 && <li className="text-xs text-slate-500">No maintenance requests recorded.</li>}
          </ul>
        </article>
      </div>
    </section>
  );
}

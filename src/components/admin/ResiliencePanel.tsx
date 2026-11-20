import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface BackupInventory {\n  status: 'available' | 'not_configured' | 'unavailable';\n  bucket: string | null;\n  retentionDays: number;\n  listedAt: string;\n  hasMore: boolean;\n  reason?: string;\n  items: Array<{ backupId: string; prefix: string; createdAt: string | null; databaseBytes: number | null; databaseSha256: string | null; manifestPresent: boolean; retention: 'within_policy' | 'outside_policy' | 'unknown' }>;\n}\n\ninterface ResilienceStatus {
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
  recovery: { status: string; productionRestore: string; drillTarget: string | null };
  selfPatch: { status: string; mode: string };
  maintenance: { status: string; automation: string };
}

interface BackupInventory {
  status: string;
  bucket: string | null;
  items: Array<{ backupId: string; createdAt: string; databaseBytes: number | null; databaseSha256: string | null; manifestValid: boolean }>;
  retentionDays: number | null;
  retentionMode: 'preview_only';
  expiredCount: number | null;
  reason?: string;
}

export default function ResiliencePanel({ userId }: { userId: string }) {
  const [status, setStatus] = useState<ResilienceStatus | null>(null);\n  const [inventory, setInventory] = useState<BackupInventory | null>(null);
  const [error, setError] = useState('');
  const [inventory, setInventory] = useState<BackupInventory | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/admin/resilience/status', { headers: { Accept: 'application/json' } }, userId);
      const payload = await response.json() as ResilienceStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Resilience status unavailable.');
      setStatus(payload);
      const inventoryResponse = await authenticatedFetch('/api/admin/resilience/backups', { headers: { Accept: 'application/json' } }, userId);
      const inventoryPayload = await inventoryResponse.json() as BackupInventory;
      if (!inventoryResponse.ok) throw new Error(inventoryPayload.reason || 'Backup inventory unavailable.');
      setInventory(inventoryPayload);
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
      const payload = await response.json() as { success?: boolean; result?: { status?: string; reason?: string; backupId?: string } };
      if (!response.ok) throw new Error(payload.result?.reason || 'Backup request failed (' + response.status + ').');
      setNotice('Backup completed: ' + (payload.result?.backupId || 'receipt recorded') + '.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backup failed.');
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
            {busy ? 'Running backup…' : 'Run database backup'}
          </button>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <h4 className="text-sm font-medium">Backup inventory</h4>
            <p className="mt-1 text-xs text-slate-400">
              {inventory?.status || 'not checked'} · {inventory?.items.length ?? 0} recorded artifacts
              · retention {inventory?.retentionDays ? inventory.retentionDays + ' days' : 'not configured'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Expired candidates: {inventory?.expiredCount ?? 'unknown'} · preview only; no automatic deletion
            </p>
            {inventory?.reason && <p className="mt-1 text-xs text-amber-200">{inventory.reason}</p>}
            <ul className="mt-2 space-y-2">
              {inventory?.items.slice(0, 5).map((item) => (
                <li key={item.backupId} className="text-xs text-slate-300">
                  <span className={item.manifestValid ? 'text-emerald-300' : 'text-amber-200'}>
                    {item.manifestValid ? 'Manifest verified' : 'Manifest incomplete'}
                  </span>
                  {' · '}{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'timestamp unavailable'}
                  {' · '}{item.databaseBytes === null ? 'size unknown' : item.databaseBytes.toLocaleString() + ' bytes'}
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">Backup inventory &amp; retention preview</h3>
            <span className="text-xs text-slate-400">Policy window: {inventory?.retentionDays ?? 30} days</span>
          </div>
          {!inventory || inventory.status !== 'available' ? (
            <p className="mt-2 text-xs text-amber-200">{inventory?.reason || 'Inventory not verified.'}</p>
          ) : inventory.items.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">No backup artifacts were returned by the storage inventory.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {inventory.items.map((item) => (
                <li key={item.prefix} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{item.backupId}</span>
                    <span className={'text-xs ' + (item.retention === 'outside_policy' ? 'text-amber-200' : 'text-slate-400')}>{item.retention.replace('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Creation time unknown'} · {item.databaseBytes == null ? 'Size unknown' : item.databaseBytes.toLocaleString() + ' bytes'} · manifest {item.manifestPresent ? 'readable' : 'missing/unreadable'}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">SHA-256: {item.databaseSha256 || 'not available'}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-amber-200">Retention is preview-only. No backup objects are deleted or modified by this panel.</p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /><h3 className="font-medium">Disaster recovery</h3></div>
          <p className="mt-2 text-sm">Recovery drill target: {status?.recovery.drillTarget || 'not configured'}</p>
          <p className="mt-1 text-xs text-slate-400">Production restore: {status?.recovery.productionRestore}</p>
          <p className="mt-2 text-xs text-amber-200">Restore drills remain isolated and require an explicitly configured recovery target.</p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5" /><h3 className="font-medium">Self-patching</h3></div>
          <p className="mt-2 text-sm">Status: {status?.selfPatch.status || 'unknown'}</p>
          <p className="mt-1 text-xs text-slate-400">Mode: isolated GitHub PR; merge and deployment remain separately gated.</p>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5" /><h3 className="font-medium">Maintenance</h3></div>
          <p className="mt-2 text-sm">Status: {status?.maintenance.status || 'unknown'}</p>
          <p className="mt-1 text-xs text-slate-400">Automation: {status?.maintenance.automation || 'unknown'}</p>
          <p className="mt-2 text-xs text-amber-200">Maintenance actions are request/audit only until the controlled lifecycle is implemented.</p>
        </article>
      </div>
    </section>
  );
}

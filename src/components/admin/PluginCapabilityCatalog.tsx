import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type CapabilityRisk = 'read' | 'write' | 'outbound' | 'destructive';
interface PluginCapability {
  id: string;
  risk: CapabilityRisk;
  requiresHumanApproval: boolean;
}
interface PluginProvider {
  id: string;
  displayName: string;
  version: string;
  categories: string[];
  description: string;
  capabilities: PluginCapability[];
  dataClassifications: string[];
  adapterStatus: 'adapter_required' | 'adapter_registered';
}
interface RegistryResponse { providers: PluginProvider[]; }

function isRegistryResponse(value: unknown): value is RegistryResponse {
  if (!value || typeof value !== 'object' || !Array.isArray((value as RegistryResponse).providers)) return false;
  return (value as RegistryResponse).providers.every((provider) =>
    !!provider && typeof provider.id === 'string'
    && typeof provider.displayName === 'string'
    && typeof provider.version === 'string'
    && Array.isArray(provider.categories)
    && Array.isArray(provider.capabilities)
    && Array.isArray(provider.dataClassifications)
    && ['adapter_required', 'adapter_registered'].includes(provider.adapterStatus)
    && provider.capabilities.every((capability) =>
      typeof capability.id === 'string'
      && ['read', 'write', 'outbound', 'destructive'].includes(capability.risk)
      && typeof capability.requiresHumanApproval === 'boolean'),
  );
}

/** Read-only view of the authenticated server-owned plugin capability catalogue. */
export default function PluginCapabilityCatalog({ userId }: { userId: string }) {
  const [providers, setProviders] = useState<PluginProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setRefreshing(true);
    try {
      const response = await authenticatedFetch('/api/plugins/registry', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      }, userId);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : `Capability registry request failed (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isRegistryResponse(payload)) throw new Error('The API returned an invalid plugin registry contract.');
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setProviders(payload.providers);
      setLoaded(true);
      setError(null);
    } catch (cause) {
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Capability registry is unavailable.');
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [refresh]);

  return (
    <section aria-labelledby="plugin-capability-catalog-title" className="rounded-xl border border-cyan-300/15 bg-slate-950/50 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Server-owned metadata · read only</p>
          <h3 id="plugin-capability-catalog-title" className="mt-1 text-base font-semibold text-white">Backend plugin capability catalogue</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Loaded from the authenticated API registry. Declared capabilities and adapter registration are descriptive metadata, not user permissions, provider connection health or execution authorization.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {error && <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
      {loading && !loaded && <p role="status" className="mt-4 text-xs text-slate-500">Loading server capability metadata…</p>}
      {!loading && !error && providers.length === 0 && <p role="status" className="mt-4 rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500">The API confirmed an empty provider catalogue.</p>}

      {providers.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => (
            <article key={provider.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">{provider.displayName}</h4>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">{provider.id} · manifest v{provider.version}</p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-300">{provider.adapterStatus === 'adapter_registered' ? 'Adapter registered' : 'Adapter required'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{provider.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {provider.categories.map((category) => <span key={category} className="rounded bg-cyan-300/5 px-2 py-1 text-[10px] text-cyan-100">{category}</span>)}
              </div>
              <div className="mt-3 border-t border-white/5 pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Declared capabilities</p>
                <ul className="space-y-1.5">
                  {provider.capabilities.map((capability) => (
                    <li key={capability.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-slate-300">{capability.id}</span>
                      <span className="text-slate-500">{capability.risk}{capability.requiresHumanApproval ? ' · human approval required' : ' · no manifest approval flag'}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-slate-500">Data classes: {provider.dataClassifications.join(', ') || 'Not declared'}</p>
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 border-t border-white/5 pt-3 text-[10px] leading-4 text-slate-500"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-300" />Gen-X and server-side policy remain authoritative. The catalogue never enables a capability or exposes credentials, connection records, or adapter execution methods.</p>
    </section>
  );
}

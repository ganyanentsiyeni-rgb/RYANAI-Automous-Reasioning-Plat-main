import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Camera, Check, Clipboard, Copy, LoaderCircle, MessageSquare, QrCode, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi, X } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { PhoneLinkSettings } from '@/lib/settingsPreferences';
import { createPhoneLinkQr } from '@/lib/phoneLinkQr';

type Device = { id: string; deviceName: string; platform: string; capabilities: string[]; status: string; lastSeenAt?: string | null; createdAt?: string };
type Capability = { id: string; label: string; state: string; approval: string };
type PhoneEvent = { id: string; deviceId: string; eventType: string; title: string; body: string; createdAt: string };

const capabilityLabels: Record<string, string> = {
  'files.receive': 'Send files to RyanAI',
  'files.send': 'Receive files from RyanAI',
  'comms.receive': 'Receive RyanAI Comms updates',
  'notifications.receive': 'RyanAI notifications',
  'voice.upload': 'Voice-note uploads',
  'voice.live': 'Live RyanAI voice (foreground service)',
  'camera.upload': 'Camera uploads',
  'share.receive': 'Android share-sheet intake',
  'tasks.receive': 'Studio task updates',
};
const availableCapabilities = Object.keys(capabilityLabels);

async function request<T>(path: string, init: RequestInit | undefined, userId: string): Promise<T> {
  const response = await authenticatedFetch(path, init, userId);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `PhoneLink request failed (HTTP ${response.status}).`);
  return payload as T;
}

export default function PhoneLinkWorkspace({ userId, settings }: { userId: string; settings: PhoneLinkSettings }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<PhoneEvent[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [pairingCode, setPairingCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimCode, setClaimCode] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('code') ?? '');
  const [claimName, setClaimName] = useState('My Android phone');
  const [nativeExchangeLink, setNativeExchangeLink] = useState('');
  const refreshRequestId = useRef(0);
  const isClaimRoute = window.location.hash.includes('/phonelink/pair');

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    setLoading(true);
    try {
      const [deviceResult, capabilityResult] = await Promise.all([
        request<{ devices: Device[] }>('/api/phonelink/devices', undefined, userId),
        request<{ capabilities: Capability[] }>('/api/phonelink/capabilities', undefined, userId),
      ]);
      if (requestId !== refreshRequestId.current) return;
      setDevices(deviceResult.devices ?? []);
      const nextCapabilities = capabilityResult.capabilities ?? [];
      setCapabilities(nextCapabilities);
      const grantableIds = new Set(nextCapabilities.filter(capability => capability.state === 'available').map(capability => capability.id));
      setSelectedCapabilities(current => current.filter(id => grantableIds.has(id)));
      try {
        const inbox = await request<{ events: PhoneEvent[] }>('/api/phonelink/events', undefined, userId);
        if (requestId === refreshRequestId.current) setEvents(inbox.events ?? []);
      } catch { if (requestId === refreshRequestId.current) setEvents([]); }
      if (requestId === refreshRequestId.current) setError('');
    } catch (cause) {
      if (requestId === refreshRequestId.current) setError(cause instanceof Error ? cause.message : 'PhoneLink could not load.');
    } finally { if (requestId === refreshRequestId.current) setLoading(false); }
  }, [userId]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { refreshRequestId.current += 1; window.clearTimeout(initialRefresh); window.clearInterval(timer); };
  }, [refresh]);

  const capabilityById = useMemo(
    () => new Map(capabilities.map(capability => [capability.id, capability])),
    [capabilities],
  );
  const isCapabilityAvailable = (id: string) => capabilityById.get(id)?.state === 'available';

  const pairingUrl = useMemo(() => {
    if (!pairingCode) return '';
    return `${window.location.origin}/#/phonelink/pair?code=${encodeURIComponent(pairingCode)}`;
  }, [pairingCode]);
  const qrMatrix = useMemo(() => {
    if (!pairingUrl) return [];
    try { return createPhoneLinkQr(pairingUrl); } catch { return []; }
  }, [pairingUrl]);

  async function createPairing() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ pairingCode: string; expiresAt: string }>('/api/phonelink/pairings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, userId);
      setPairingCode(result.pairingCode);
      setExpiresAt(result.expiresAt);
      setNotice('A single-use pairing code is ready. It expires in five minutes.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a pairing code.'); }
    finally { setBusy(false); }
  }

  async function claimPairing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !claimCode.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ exchangeCode?: string }>('/api/phonelink/pairings/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairingCode: claimCode.trim(), deviceName: claimName, platform: 'android', capabilities: selectedCapabilities }) }, userId);
      if (result.exchangeCode) setNativeExchangeLink(`ryanai-phonelink://pair?code=${encodeURIComponent(result.exchangeCode)}`);
      setNotice('This phone is now registered as a trusted RyanAI device.');
      setClaimCode('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pairing could not be completed.'); }
    finally { setBusy(false); }
  }

  async function revokeDevice(id: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/api/phonelink/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }, userId);
      setDevices(current => current.map(device => device.id === id ? { ...device, status: 'revoked' } : device));
      setNotice('Device access revoked.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revoke this device.'); }
    finally { setBusy(false); }
  }

  async function acknowledgeEvent(deviceId: string, eventId: string) {
    try {
      await request(`/api/phonelink/devices/${encodeURIComponent(deviceId)}/events/${encodeURIComponent(eventId)}/ack`, { method: 'POST' }, userId);
      setEvents(current => current.filter(event => event.id !== eventId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not acknowledge this PhoneLink event.'); }
  }

  async function updateDevice(device: Device, next: string[]) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/api/phonelink/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: device.deviceName, capabilities: next }) }, userId);
      setDevices(current => current.map(item => item.id === device.id ? { ...item, capabilities: next } : item));
      setNotice('Device permissions updated.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update device permissions.'); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access is unavailable. Select and copy the pairing link manually.'); }
  }

  if (isClaimRoute) return <section className="mx-auto max-w-2xl space-y-5 px-5 py-10 text-slate-100">
    <a href="#/phonelink" className="text-sm text-cyan-300">← Back to PhoneLink</a>
    <header><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / PhoneLink</p><h1 className="mt-2 text-3xl font-bold">Connect this phone</h1><p className="mt-2 text-sm text-slate-400">Sign in to the same RyanAI account that created the pairing code, then approve this device.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-400/30 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-400/30 p-3 text-sm text-emerald-200">{notice}</p>}
    {nativeExchangeLink && <a href={nativeExchangeLink} className="inline-flex rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">Open RyanAI PhoneLink app</a>}
    <form onSubmit={claimPairing} className="space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5">
      <label className="block text-sm">Pairing code<input value={claimCode} onChange={event => setClaimCode(event.target.value)} required className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 p-3 font-mono" /></label>
      <label className="block text-sm">Device name<input value={claimName} onChange={event => setClaimName(event.target.value)} maxLength={80} className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 p-3" /></label>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">Allow verified capabilities</legend><p className="text-xs text-slate-500">Only capabilities reported as available by the RyanAI backend can be granted. Unsupported adapters remain disabled.</p><div className="grid gap-2 sm:grid-cols-2">{availableCapabilities.map(id=>{const capability=capabilityById.get(id);const grantable=capability?.state==='available';return <label key={id} className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" aria-label={`Allow ${capabilityLabels[id]}`} checked={selectedCapabilities.includes(id)} disabled={busy||!grantable} onChange={event=>setSelectedCapabilities(current=>event.target.checked?[...current,id]:current.filter(item=>item!==id))} className="mt-0.5 accent-cyan-400"/><span className="min-w-0"><span className="block">{capabilityLabels[id]}</span><span className={`mt-0.5 block text-[10px] ${grantable?'text-emerald-300':'text-amber-200'}`}>{capability ? capability.state.replaceAll('_',' ') : 'availability not verified'}</span></span></label>})}</div></fieldset>
      <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Smartphone className="h-4 w-4"/>} Approve this phone</button>
    </form>
  </section>;

  return <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 text-slate-100 sm:px-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Mobile</p><h1 className="mt-2 text-3xl font-bold">PhoneLink</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Securely connect your Android phone to RyanAI. Pairing is tied to your authenticated account and every device can be revoked.</p></div><button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/> Refresh</button></header>
    {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex items-center gap-3"><QrCode className="h-6 w-6 text-cyan-300"/><div><h2 className="font-semibold">Pair a new device</h2><p className="text-xs text-slate-400">QR link · single-use code · five-minute expiry</p></div></div>
        {!pairingCode ? <button onClick={() => void createPairing()} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Preparing…' : 'Generate pairing QR'}</button> : <div className="mt-5 grid gap-4 sm:grid-cols-[190px_1fr]">
          <div className="rounded-xl bg-white p-3 text-slate-950"><svg role="img" aria-label="PhoneLink pairing QR code" viewBox="-4 -4 45 45" className="w-full" shapeRendering="crispEdges"><rect x="-4" y="-4" width="45" height="45" fill="white"/>{qrMatrix.map((row,y)=>row.map((dark,x)=>dark?<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#07111f"/>:null))}</svg><p className="mt-2 text-center text-[10px] text-slate-500">Scan with RyanAI PhoneLink</p></div>
          <div className="space-y-3"><p className="text-xs text-slate-400">Expires {new Date(expiresAt).toLocaleTimeString()}</p><p className="break-all rounded-lg bg-slate-950 p-3 font-mono text-xs">{pairingCode}</p><button onClick={() => void copy(pairingUrl)} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm"><Copy className="h-4 w-4"/> Copy pairing link</button><button onClick={() => {setPairingCode('');setExpiresAt('');}} className="ml-2 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm"><X className="h-4 w-4"/> Close</button><p className="text-xs text-amber-200">The phone must sign in to the same RyanAI account. Never share this temporary code publicly.</p></div>
        </div>}
      </article>
      <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6"><h2 className="font-semibold">PhoneLink bridge</h2><p className="mt-2 text-xs text-slate-400">Account defaults: {settings.wifiOnlyTransfers ? 'Wi-Fi-first transfers' : 'Wi-Fi and mobile data'} · {settings.requireConfirmation ? 'sensitive-action confirmation on' : 'sensitive-action confirmation off'} · {settings.quietHoursEnabled ? `quiet hours ${settings.quietHoursStart}–${settings.quietHoursEnd}` : 'quiet hours off'}</p><p className="mt-2 text-sm text-slate-400">The device registry and Comms event inbox are integrated. Native Android share, file transfer, push delivery, camera and voice capture still require their reviewed adapters and device testing.</p><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-950 p-3"><Smartphone className="h-5 w-5 text-cyan-300"/><p className="mt-2 text-sm font-medium">Device registry</p><p className="text-xs text-emerald-300">API integrated</p></div><div className="rounded-xl bg-slate-950 p-3"><MessageSquare className="h-5 w-5 text-cyan-300"/><p className="mt-2 text-sm font-medium">Comms inbox</p><p className="text-xs text-emerald-300">Event queue integrated</p></div><div className="rounded-xl bg-slate-950 p-3"><ArrowUpFromLine className="h-5 w-5 text-cyan-300"/><p className="mt-2 text-sm font-medium">Phone → RyanAI</p><p className="text-xs text-amber-200">Native share pending</p></div><div className="rounded-xl bg-slate-950 p-3"><ArrowDownToLine className="h-5 w-5 text-cyan-300"/><p className="mt-2 text-sm font-medium">RyanAI → phone</p><p className="text-xs text-amber-200">Push provider pending</p></div></div></article>
    </div>
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Trusted devices</h2><p className="mt-1 text-xs text-slate-400">Only devices paired to your account appear here.</p></div><span className="text-xs text-slate-400">{devices.filter(device=>device.status==='paired').length} active</span></div>
      {loading ? <p className="mt-4 text-sm text-slate-400">Loading devices…</p> : devices.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-white/15 p-5 text-sm text-slate-400">No phones connected yet. Generate a QR pairing code to begin.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{devices.map(device=><div key={device.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-cyan-300"/><div><p className="font-medium">{device.deviceName}</p><p className="text-xs text-slate-500">{device.platform} · {device.status}</p></div></div>{device.status==='paired'&&<button onClick={()=>void revokeDevice(device.id)} disabled={busy} aria-label={`Revoke ${device.deviceName}`} className="rounded-lg p-2 text-rose-300 hover:bg-rose-400/10"><Trash2 className="h-4 w-4"/></button>}</div><p className="mt-3 text-xs text-slate-400">Device permissions · changes save immediately</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{availableCapabilities.map(cap=>{const granted=device.capabilities?.includes(cap)??false;const grantable=isCapabilityAvailable(cap);return <label key={cap} className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" aria-label={`Allow ${capabilityLabels[cap]} on ${device.deviceName}`} checked={granted} disabled={busy||device.status!=='paired'||(!grantable&&!granted)} onChange={event=>void updateDevice(device,event.target.checked?[...(device.capabilities??[]),cap]:(device.capabilities??[]).filter(item=>item!==cap))} className="accent-cyan-400"/><span>{capabilityLabels[cap]}{!grantable&&granted?' · stored grant unavailable':''}</span></label>})}</div></div>)}</div>}
    </article>
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">PhoneLink Comms inbox</h2><p className="mt-1 text-xs text-slate-400">Reviewed Comms dispatch updates are queued for devices with Comms permission.</p></div><span className="text-xs text-slate-400">{events.length} pending</span></div>{events.length===0?<p className="mt-4 text-sm text-slate-500">No queued mobile updates.</p>:<div className="mt-3 space-y-2">{events.map(event=><div key={event.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-950 p-3"><div><p className="text-sm font-medium">{event.title}</p><p className="mt-1 text-xs text-slate-400">{event.body}</p><p className="mt-1 text-[10px] text-slate-600">{new Date(event.createdAt).toLocaleString()}</p></div><button onClick={()=>{void acknowledgeEvent(event.deviceId,event.id);}} className="rounded-lg p-2 text-emerald-300" aria-label="Acknowledge event"><Check className="h-4 w-4"/></button></div>)}</div>}</article>
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold">Mobile capability registry</h2><p className="mt-1 text-xs text-slate-400">Permissions are explicit and scoped. Unsupported native capabilities are identified rather than silently enabled.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{capabilities.map(cap=><div key={cap.id} className="rounded-xl bg-slate-950 p-3"><p className="text-sm font-medium">{cap.label}</p><p className={`mt-1 text-xs ${cap.state==='available'?'text-emerald-300':'text-amber-200'}`}>{cap.state.replaceAll('_',' ')}</p><p className="mt-1 text-[11px] text-slate-500">Approval: {cap.approval}</p></div>)}</div></article>
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold">Security and privacy</h2><div className="mt-3 grid gap-3 text-sm text-slate-300 sm:grid-cols-2"><p><ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-300"/>Pairing codes expire after five minutes and can only be used once.</p><p><Wifi className="mr-2 inline h-4 w-4 text-cyan-300"/>Android stores a revocable device token encrypted with Keystore; RyanAI stores only its SHA-256 digest.</p><p><Clipboard className="mr-2 inline h-4 w-4 text-cyan-300"/>Clipboard sharing is never read automatically.</p><p><Camera className="mr-2 inline h-4 w-4 text-cyan-300"/>Camera, microphone, notifications and location require explicit Android permissions.</p><p><ShieldCheck className="mr-2 inline h-4 w-4 text-cyan-300"/>Comms outbound dispatch remains behind human review.</p><p><Activity className="mr-2 inline h-4 w-4 text-cyan-300"/>Revoking a device disables its registry entry.</p></div></article>
  </section>;
}

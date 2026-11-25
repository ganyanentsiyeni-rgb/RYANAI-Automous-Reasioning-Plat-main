import { performance } from 'node:perf_hooks';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'not_probed';

export interface ProviderHealthProbeResult {
  status: Exclude<ProviderHealthStatus, 'not_probed'>;
  checkedAt: string;
  latencyMs: number;
  safeNote: string;
}

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 10_000;

const PROBE_ENDPOINTS: Record<string, string> = {
  'google-calendar': 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
  gmail: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
  'microsoft-365-calendar': 'https://graph.microsoft.com/v1.0/me?$select=id',
};

function classifyResponse(status: number): { status: Exclude<ProviderHealthStatus, 'not_probed'>; safeNote: string } {
  if (status >= 200 && status < 300) return { status: 'healthy', safeNote: 'Authenticated provider probe succeeded.' };
  if (status === 401 || status === 403) return { status: 'unavailable', safeNote: 'Provider rejected the stored authorization.' };
  if (status === 408 || status === 429 || status >= 500) return { status: 'degraded', safeNote: 'Provider returned a transient health-check failure.' };
  return { status: 'unavailable', safeNote: 'Provider rejected the authenticated health probe.' };
}

export async function probeAuthenticatedProvider(
  providerId: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthProbeResult> {
  const endpoint = PROBE_ENDPOINTS[providerId];
  if (!endpoint) throw new Error('Authenticated health probe is not supported for this provider.');

  const started = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + accessToken,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const result = classifyResponse(response.status);
    return {
      ...result,
      checkedAt,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  } catch {
    return {
      status: 'unavailable',
      checkedAt,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      safeNote: 'Provider health probe failed before an HTTP response.',
    };
  }
}

export interface StoredProviderHealthEvidence {
  status: ProviderHealthStatus;
  checkedAt: string | null;
  latencyMs: number | null;
  safeNote: string | null;
}

export function readStoredProviderHealthEvidence(metadata: unknown): StoredProviderHealthEvidence {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { status: 'not_probed', checkedAt: null, latencyMs: null, safeNote: null };
  }
  const health = (metadata as Record<string, unknown>).health;
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return { status: 'not_probed', checkedAt: null, latencyMs: null, safeNote: null };
  }

  const status = (health as Record<string, unknown>).status;
  const checkedAt = (health as Record<string, unknown>).checkedAt;
  const latencyMs = (health as Record<string, unknown>).latencyMs;
  const safeNote = (health as Record<string, unknown>).safeNote;

  const validStatus: ProviderHealthStatus =
    status === 'healthy' || status === 'degraded' || status === 'unavailable'
      ? status : 'not_probed';

  return {
    status: validStatus,
    checkedAt: typeof checkedAt === 'string' ? checkedAt : null,
    latencyMs: typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? latencyMs : null,
    safeNote: typeof safeNote === 'string' ? safeNote : null,
  };
}

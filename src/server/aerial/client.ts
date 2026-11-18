import { loadAerialConfig, type AerialConfig } from './config.js';

export interface AerialHealth {
  status: 'healthy' | 'degraded' | 'disabled';
  mode: AerialConfig['mode'];
  endpoint: string | null;
  model: string;
  latencyMs?: number;
  detail?: string;
}

export interface AerialInferenceRequest {
  prompt: string;
  model?: string;
  inputs?: unknown;
}

export interface AerialInferenceResult {
  response: string;
  model: string;
  provider: 'nvidia-aerial';
  simulated: boolean;
  latencyMs: number;
  raw?: unknown;
}

function joinUrl(base: string, path: string): string {
  return new URL(path.startsWith('/') ? path.slice(1) : path, base.endsWith('/') ? base : base + '/').toString();
}

function authHeaders(config: AerialConfig): Record<string, string> {
  return config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {};
}

export class AerialClient {
  constructor(private readonly config: AerialConfig = loadAerialConfig()) {}

  getConfig(): AerialConfig {
    return this.config;
  }

  async health(signal?: AbortSignal): Promise<AerialHealth> {
    if (!this.config.enabled) {
      return {
        status: 'disabled',
        mode: 'disabled',
        endpoint: null,
        model: this.config.model,
        detail: 'Aerial integration is not configured.',
      };
    }

    if (this.config.mode === 'development-simulator') {
      return {
        status: 'healthy',
        mode: 'development-simulator',
        endpoint: 'in-process://aerial-dev',
        model: this.config.model,
        latencyMs: 0,
        detail: 'Development Aerial contract simulator is active; no NVIDIA hardware is claimed.',
      };
    }

    const started = Date.now();
    try {
      const response = await fetch(
        joinUrl(this.config.baseUrl!, this.config.healthPath),
        {
          headers: authHeaders(this.config),
          signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      const latencyMs = Date.now() - started;
      return {
        status: response.ok ? 'healthy' : 'degraded',
        mode: 'external',
        endpoint: this.config.baseUrl,
        model: this.config.model,
        latencyMs,
        detail: response.ok ? undefined : 'Aerial runtime returned HTTP ' + response.status + '.',
      };
    } catch {
      return {
        status: 'degraded',
        mode: 'external',
        endpoint: this.config.baseUrl,
        model: this.config.model,
        latencyMs: Date.now() - started,
        detail: 'Aerial runtime health probe failed.',
      };
    }
  }

  async infer(request: AerialInferenceRequest, signal?: AbortSignal): Promise<AerialInferenceResult> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error('Aerial inference prompt is required.');

    const started = Date.now();
    if (this.config.mode === 'development-simulator') {
      return {
        response: 'Aerial development simulation received: ' + prompt.slice(0, 240),
        model: request.model ?? this.config.model,
        provider: 'nvidia-aerial',
        simulated: true,
        latencyMs: Date.now() - started,
      };
    }

    if (!this.config.inferenceUrl) {
      throw new Error('AERIAL_INFERENCE_URL is required for external Aerial inference.');
    }

    const response = await fetch(this.config.inferenceUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(this.config),
      },
      body: JSON.stringify({
        model: request.model ?? this.config.model,
        prompt,
        inputs: request.inputs,
      }),
      signal: signal ?? AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error('Aerial inference endpoint returned HTTP ' + response.status + '.');
    }

    const raw = await response.json() as Record<string, unknown>;
    const text = typeof raw.response === 'string'
      ? raw.response
      : typeof raw.output === 'string'
        ? raw.output
        : typeof raw.text === 'string'
          ? raw.text
          : Array.isArray(raw.choices) && typeof raw.choices[0] === 'object' && raw.choices[0] !== null
            ? typeof (raw.choices[0] as { text?: unknown }).text === 'string'
              ? (raw.choices[0] as { text: string }).text
              : ''
            : '';

    if (!text.trim()) {
      throw new Error('Aerial inference endpoint returned no textual response.');
    }

    return {
      response: text,
      model: request.model ?? this.config.model,
      provider: 'nvidia-aerial',
      simulated: false,
      latencyMs: Date.now() - started,
      raw,
    };
  }
}

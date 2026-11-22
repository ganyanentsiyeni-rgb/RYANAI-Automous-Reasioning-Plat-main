import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export interface DatabaseStoreConfig {
  adapter: 'postgresql' | 'redis';
  url_env: string;
  direct_url_env?: string;
  schema?: string;
  required?: boolean;
  required_tables?: string[];
  required_runtime_tables?: string[];
}

export interface DatabaseManifest {
  version: number;
  environments: Record<string, {
    primary: DatabaseStoreConfig;
    cache: DatabaseStoreConfig;
    audiobook?: DatabaseStoreConfig;
  }>;
  agent_runs: {
    table: string;
    schema: string;
    required_columns: string[];
    lifecycle: Record<string, unknown>;
  };
  runtime: Record<string, unknown>;
  governance: Record<string, unknown>;
  fleet_contract: {
    expected_agents: number;
    expected_workers: number;
    source_of_truth: string;
    note: string;
  };
}

const DEFAULT_MANIFEST_PATH = resolve(process.cwd(), 'database.yml');

function resolvePlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(resolvePlaceholders);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolvePlaceholders(child)]),
    );
  }
  return value;
}

export function loadDatabaseManifest(path = DEFAULT_MANIFEST_PATH): DatabaseManifest {
  const raw = parse(readFileSync(path, 'utf8')) as DatabaseManifest;
  if (!raw || raw.version !== 1 || !raw.environments) {
    throw new Error('Invalid database.yml: expected version 1 and environments.');
  }
  return resolvePlaceholders(raw) as DatabaseManifest;
}

export function getDatabaseStore(
  environment: string,
  store: 'primary' | 'cache' | 'audiobook' = 'primary',
  path = DEFAULT_MANIFEST_PATH,
): DatabaseStoreConfig {
  const manifest = loadDatabaseManifest(path);
  const env = manifest.environments[environment];
  if (!env) throw new Error(`database.yml has no environment '${environment}'.`);
  const config = env[store];
  if (!config) throw new Error(`database.yml has no '${store}' store for '${environment}'.`);
  return config;
}

export function getDatabaseUrl(
  environment: string,
  store: 'primary' | 'cache' | 'audiobook' = 'primary',
  useDirect = false,
  path = DEFAULT_MANIFEST_PATH,
): string | undefined {
  const config = getDatabaseStore(environment, store, path);
  const envName = useDirect && config.direct_url_env ? config.direct_url_env : config.url_env;
  return process.env[envName]?.trim() || undefined;
}

export function assertDatabaseManifestContract(
  environment: string,
  path = DEFAULT_MANIFEST_PATH,
): void {
  const primary = getDatabaseStore(environment, 'primary', path);
  const cache = getDatabaseStore(environment, 'cache', path);

  if (primary.adapter !== 'postgresql') throw new Error('database.yml primary store must be PostgreSQL.');
  if (cache.adapter !== 'redis') throw new Error('database.yml cache store must be Redis.');
  if (primary.schema !== 'public') throw new Error('database.yml primary schema must be public.');
  if (primary.required_tables?.includes('agent_runs') !== true) {
    throw new Error('database.yml primary store must require public.agent_runs.');
  }
}

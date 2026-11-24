import { resolveSupabaseSessionPoolerUrl } from './supabasePooler.ts';
import { assertDatabaseManifestContract, getDatabaseStore } from '../config/databaseConfig.js';

export interface ConnectionUrls {
  databaseUrl: string;
  redisUrl: string;
}

function localDevelopmentDatabaseUrl(): string {
  const url = new URL('postgresql:' + '//localhost:5432/ryanai');
  url.username = 'postgres';
  url.password = 'postgres';
  return url.toString();
}

function parseProductionDatabaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      'Invalid DATABASE_URL: expected a complete PostgreSQL connection URI (postgresql:// or postgres://). Percent-encode reserved characters in the username or password. Credentials are not logged.',
    );
  }

  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
    || !parsed.hostname
  ) {
    throw new Error(
      'Invalid DATABASE_URL: expected a PostgreSQL URI with a hostname. Credentials are not logged.',
    );
  }

  return parsed;
}

function isSupabaseDatabaseUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return /^db\.[a-z0-9]{20}\.supabase\.co$/.test(hostname)
      || hostname.endsWith('.pooler.supabase.com');
  } catch {
    return false;
  }
}

function assertDatabaseUrlMatchesSupabaseProject(databaseUrl: string, supabaseUrl: string): void {
  let database: URL;
  let project: URL;
  try {
    database = new URL(databaseUrl);
    project = new URL(supabaseUrl);
  } catch {
    throw new Error('Invalid Supabase project or DATABASE_URL configuration. Credentials are not logged.');
  }

  const projectMatch = project.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (project.protocol !== 'https:' || !projectMatch) {
    throw new Error('SUPABASE_URL must identify the configured Supabase project. Credentials are not logged.');
  }

  const projectRef = projectMatch[1];
  const databaseHost = database.hostname.toLowerCase();
  if (databaseHost === `db.${projectRef}.supabase.co`) return;

  if (databaseHost.endsWith('.pooler.supabase.com')) {
    let username: string;
    try {
      username = decodeURIComponent(database.username);
    } catch {
      throw new Error('DATABASE_URL has an invalid PostgreSQL username encoding. Credentials are not logged.');
    }
    const usernameProjectRef = username.split('.').slice(1).join('.').toLowerCase();
    // An unqualified legacy username is safe to normalize because the pooler
    // resolver rewrites it to the project-qualified form before connecting.
    // If a project suffix is present, it must match the configured project.
    if (!usernameProjectRef || usernameProjectRef === projectRef) return;
    throw new Error(
      'DATABASE_URL Session Pooler username identifies a different Supabase project than SUPABASE_URL. Credentials are not logged.',
    );
  }

  throw new Error(
    'DATABASE_URL must target the Supabase project configured by SUPABASE_URL; do not use a separate Render PostgreSQL resource for the RyanAI primary database. Credentials are not logged.',
  );
}

/**
 * Resolve required service URLs without silently selecting local services in production.
 * Supabase production URLs are normalized to the explicitly configured Session Pooler
 * endpoint before either Prisma or node-postgres receives the connection string.
 * Local defaults remain available only for development and test environments.
 */
export function resolveConnectionUrls(
  nodeEnv: string,
  databaseUrl?: string,
  redisUrl?: string,
  supabaseUrl?: string,
  sessionPoolerHost?: string,
  sslRootCertPath?: string,
  localCompose = false,
): ConnectionUrls {
  let database = databaseUrl?.trim();
  const redis = redisUrl?.trim();

  const strictRuntime = nodeEnv === 'production' || nodeEnv === 'staging';
  // Tests must never inherit a hosted Supabase DATABASE_URL from a dotenv
  // overlay. Keep explicit loopback test databases, but fall back to the
  // isolated local default when the inherited URL is hosted.
  if (nodeEnv === 'test' && database && isSupabaseDatabaseUrl(database)) {
    database = undefined;
  }
  const manifestEnvironment = strictRuntime ? nodeEnv : 'staging';
  assertDatabaseManifestContract(manifestEnvironment);
  const primaryStore = getDatabaseStore(manifestEnvironment, 'primary');
  const cacheStore = getDatabaseStore(manifestEnvironment, 'cache');

  const isLocalComposeDatabase = localCompose && (() => {
    try {
      const parsed = new URL(database ?? '');
      return parsed.hostname === 'postgres' && (parsed.port || '5432') === '5432';
    } catch {
      return false;
    }
  })();

  if (strictRuntime && database) {
    parseProductionDatabaseUrl(database);
    if (supabaseUrl?.trim() && !isLocalComposeDatabase) {
      assertDatabaseUrlMatchesSupabaseProject(database, supabaseUrl);
    }
  }

  if (database && isSupabaseDatabaseUrl(database)) {
    const pooler = resolveSupabaseSessionPoolerUrl(
      database,
      supabaseUrl,
      sessionPoolerHost,
      sslRootCertPath,
    );

    if (
      pooler.reason !== 'rewritten'
      && pooler.reason !== 'already-pooled'
    ) {
      throw new Error(
        `Invalid Supabase Session Pooler configuration (${pooler.reason}). Set SUPABASE_URL and the exact SUPABASE_SESSION_POOLER_HOST copied from Supabase Connect; ensure DATABASE_URL contains the database password. Credentials are not logged.`,
      );
    }

    database = pooler.databaseUrl;
  }

  if (strictRuntime) {
    const missing = [
      !database ? primaryStore.url_env : undefined,
      !redis ? cacheStore.url_env : undefined,
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(
        `Missing required production connection configuration: ${missing.join(', ')}. Set these variables before starting the API.`,
      );
    }
  }

  return {
    databaseUrl: database || localDevelopmentDatabaseUrl(),
    redisUrl: redis || 'redis://localhost:6379',
  };
}


/**
 * Prevent production and staging API processes from listening when required
 * infrastructure failed its startup connectivity check. Local development and
 * isolated tests retain degraded-start behavior.
 */
export function assertProductionDependencies(
  nodeEnv: string,
  services: { database: boolean; redis: boolean; agentCheckpointer: boolean },
): void {
  if (nodeEnv !== 'production' && nodeEnv !== 'staging') return;

  const unavailable = [
    !services.database ? 'PostgreSQL' : undefined,
    !services.redis ? 'Redis' : undefined,
    !services.agentCheckpointer ? 'agent checkpointer' : undefined,
  ].filter(Boolean);

  if (unavailable.length) {
    throw new Error(
      `${nodeEnv} startup blocked: required dependency checks failed for ${unavailable.join(', ')}. The API listener was not started.`,
    );
  }
}

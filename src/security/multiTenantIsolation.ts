import { Pool, PoolClient } from 'pg';
import { resolveConnectionUrls } from '../server/startupConfig.js';

export interface TenantContext {
  organizationId: string;
  userId: string;
  role: 'ADMIN' | 'ENGINEER' | 'AUDITOR';
}

export class MultiTenantIsolationEngine {
  private pool: Pool;

  constructor() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const { databaseUrl } = resolveConnectionUrls(
      nodeEnv,
      process.env.DATABASE_URL,
      process.env.REDIS_URL,
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SESSION_POOLER_HOST,
      process.env.SUPABASE_SSL_ROOT_CERT_PATH,
      process.env.RYANAI_LOCAL_COMPOSE === 'true',
      process.env.RYANAI_DISPOSABLE_SUPABASE === '1',
    );
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }

  async executeScopedQuery<T>(
    context: TenantContext,
    queryFn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [context.organizationId]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [context.userId]);
      await client.query("SELECT set_config('app.current_user_role', $1, true)", [context.role]);

      const result = await queryFn(client);

      await client.query('COMMIT;');
      return result;
    } catch (error) {
      await client.query('ROLLBACK;');
      throw error;
    } finally {
      client.release();
    }
  }
}
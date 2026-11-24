import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { resolveConnectionUrls } from "../server/startupConfig.js";

const nodeEnv = process.env.NODE_ENV || "production";
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

// Keep the worker on the same validated Session Pooler endpoint and TLS
// configuration as the API's Prisma client. In particular, do not pass a
// separate ssl object: node-postgres would let it override sslrootcert and
// sslmode parsed from the connection URI.
export const postgresPool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  min: 0,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  application_name: "ryanai-agent-worker",
});

postgresPool.on("error", (error) => {
  console.error("[PostgreSQL] Idle client error:", error.message);
});

// LangGraph checkpoint persistence. Schema setup remains an explicit,
// separately approved operation; this module never runs setup() at startup.
export const checkpointer = new PostgresSaver(
  postgresPool,
  undefined,
  { schema: "public" }
);

// Read-only connectivity verification. Does not run migrations or modify records.
export async function verifyPostgres(): Promise<boolean> {
  try {
    const result = await postgresPool.query(
      "SELECT current_database(), current_timestamp"
    );
    return result.rowCount === 1;
  } catch (error) {
    console.error("[PostgreSQL] Health check failed:", error);
    return false;
  }
}

// Graceful connection shutdown.
export async function closePostgres(): Promise<void> {
  await postgresPool.end();
}


import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

// Persistent backend connection pool.
// Use the actual Supabase Session Pooler URL
// copied from the Supabase Connect dashboard.
export const postgresPool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  min: 0,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  ssl: {
    rejectUnauthorized: true,
  },
  application_name: "ryanai-agent-worker",
});

postgresPool.on("error", (error) => {
  console.error("[PostgreSQL] Idle client error:", error.message);
});

// LangGraph checkpoint persistence.
export const checkpointer = new PostgresSaver(
  postgresPool,
  undefined,
  { schema: "public" }
);

// Read-only connectivity verification.
// Does not run migrations or modify application records.
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

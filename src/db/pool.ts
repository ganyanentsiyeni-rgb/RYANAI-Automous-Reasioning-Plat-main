// File path: ./src/db/pool.ts

import { Pool } from "pg";
import { resolveConnectionUrls } from "../server/startupConfig.js";

const nodeEnv = process.env.NODE_ENV || "development";
const { databaseUrl: connectionString } = resolveConnectionUrls(
  nodeEnv,
  process.env.DATABASE_URL,
  process.env.REDIS_URL,
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SESSION_POOLER_HOST,
  process.env.SUPABASE_SSL_ROOT_CERT_PATH,
  process.env.RYANAI_LOCAL_COMPOSE === "true",
  process.env.RYANAI_DISPOSABLE_SUPABASE === "1",
);

export const dbPool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

dbPool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
  process.exit(-1);
});
// File path: ./src/lib/prisma.ts

import { PrismaClient } from "@prisma/client";
import { resolveConnectionUrls } from "../server/startupConfig.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Route every Prisma client through the same validated Supabase Session Pooler
// resolver used by the API launcher. Some route modules import this singleton
// directly instead of using fastify.prisma; passing raw DATABASE_URL here would
// bypass project-qualified pooler usernames and the verified TLS configuration.
const nodeEnv = process.env.NODE_ENV || "production";
const { databaseUrl } = resolveConnectionUrls(
  nodeEnv,
  process.env.DATABASE_URL,
  process.env.REDIS_URL,
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SESSION_POOLER_HOST,
  process.env.SUPABASE_SSL_ROOT_CERT_PATH,
);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

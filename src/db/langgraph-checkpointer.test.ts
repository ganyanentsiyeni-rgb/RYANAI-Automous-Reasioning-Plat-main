import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ poolOptions: [] as unknown[] }));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      captured.poolOptions.push(options);
    }
    on() {}
    async query() {
      return { rowCount: 1, rows: [{ current_database: "fixture" }] };
    }
    async end() {}
  },
}));

vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: class {
    constructor() {}
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  captured.poolOptions.length = 0;
});

describe("LangGraph PostgreSQL pool configuration", () => {
  it("uses the validated project-qualified Supabase Session Pooler URL and CA settings", async () => {
    const projectRef = "omqavyppdoniehseokvx";
    const poolerHost = "aws-1-eu-central-1.pooler.supabase.com";
    const source = new URL(
      `postgresql://postgres.${projectRef}:test-placeholder@db.${projectRef}.supabase.co:5432/postgres`,
    );

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", source.toString());
    vi.stubEnv("REDIS_URL", "redis://cache:6379");
    vi.stubEnv("SUPABASE_URL", `https://${projectRef}.supabase.co`);
    vi.stubEnv("SUPABASE_SESSION_POOLER_HOST", poolerHost);
    vi.stubEnv(
      "SUPABASE_SSL_ROOT_CERT_PATH",
      "/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt",
    );

    const { postgresPool } = await import("./langgraph-checkpointer.js");

    expect(postgresPool).toBeDefined();
    const options = captured.poolOptions.at(-1) as {
      connectionString: string;
      ssl?: unknown;
    };
    const resolved = new URL(options.connectionString);

    expect(resolved.hostname).toBe(poolerHost);
    expect(resolved.port).toBe("5432");
    expect(resolved.username).toBe(`postgres.${projectRef}`);
    expect(resolved.searchParams.get("sslmode")).toBe("verify-full");
    expect(resolved.searchParams.get("sslrootcert")).toBe(
      "/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt",
    );
    expect(resolved.searchParams.get("sslaccept")).toBe("strict");
    expect(options.ssl).toBeUndefined();
  });

  it("fails closed when production Supabase pooler configuration is incomplete", async () => {
    const projectRef = "omqavyppdoniehseokvx";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      `postgresql://postgres:test-placeholder@db.${projectRef}.supabase.co:5432/postgres`,
    );
    vi.stubEnv("REDIS_URL", "redis://cache:6379");
    vi.stubEnv("SUPABASE_URL", `https://${projectRef}.supabase.co`);
    vi.stubEnv("SUPABASE_SESSION_POOLER_HOST", "");

    await expect(import("./langgraph-checkpointer.js")).rejects.toThrow(
      "SUPABASE_SESSION_POOLER_HOST",
    );
    expect(captured.poolOptions).toHaveLength(0);
  });
});

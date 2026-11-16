import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const setup = vi.fn();
  const saver = { setup };
  const fromConnString = vi.fn(() => saver);
  const memorySaver = { kind: 'ephemeral-memory-saver' };
  const MemorySaver = vi.fn(function MockMemorySaver() {
    return memorySaver;
  });
  const createReactAgent = vi.fn(() => ({}));
  return {
    setup,
    saver,
    fromConnString,
    memorySaver,
    MemorySaver,
    createReactAgent,
  };
});

vi.mock('@langchain/langgraph', () => ({
  MemorySaver: state.MemorySaver,
}));
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: { fromConnString: state.fromConnString },
}));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: state.createReactAgent,
}));
vi.mock('./tools/commsTools.js', () => ({ commsTools: [] }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('agent checkpointer initialization', () => {
  it('constructs the PostgreSQL saver from the validated database URL without running schema DDL', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'postgres');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1:5432/ryanai_test');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    const { checkpointer, humanInTheLoopAgent } = await import('./approvalEngine.js');

    expect(state.fromConnString).toHaveBeenCalledExactlyOnceWith(
      'postgresql://test:test@127.0.0.1:5432/ryanai_test',
    );
    expect(checkpointer).toBe(state.saver);
    expect(state.MemorySaver).not.toHaveBeenCalled();
    expect(state.setup).not.toHaveBeenCalled();
    expect(state.createReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointSaver: state.saver,
        tools: [],
        interruptBefore: ['tools'],
      }),
    );
    expect(humanInTheLoopAgent).toBeDefined();
  });

  it('routes the production LangGraph saver through the configured Supabase Session Pooler with strict TLS', async () => {
    const projectRef = 'narsvpwymvlrhurqbthu';
    const poolerHost = 'aws-1-eu-west-1.pooler.supabase.com';
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'postgres');
    vi.stubEnv('DATABASE_URL', `postgresql://postgres:test-password@db.${projectRef}.supabase.co:5432/postgres`);
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.stubEnv('SUPABASE_URL', `https://${projectRef}.supabase.co`);
    vi.stubEnv('SUPABASE_SESSION_POOLER_HOST', poolerHost);
    vi.stubEnv('SUPABASE_SSL_ROOT_CERT_PATH', '/etc/ssl/supabase-root.crt');

    await import('./approvalEngine.js');

    expect(state.fromConnString).toHaveBeenCalledExactlyOnce();
    const resolved = new URL(state.fromConnString.mock.calls[0][0] as string);
    expect(resolved.hostname).toBe(poolerHost);
    expect(resolved.port).toBe('5432');
    expect(resolved.username).toBe(`postgres.${projectRef}`);
    expect(resolved.searchParams.get('sslmode')).toBe('verify-full');
    expect(resolved.searchParams.get('sslrootcert')).toBe('/etc/ssl/supabase-root.crt');
    expect(resolved.searchParams.get('sslaccept')).toBe('strict');
    expect(state.setup).not.toHaveBeenCalled();
  });

  it('fails closed when production Supabase pooler configuration is incomplete', async () => {
    const projectRef = 'narsvpwymvlrhurqbthu';
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'postgres');
    vi.stubEnv('DATABASE_URL', `postgresql://postgres:test-password@db.${projectRef}.supabase.co:5432/postgres`);
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.stubEnv('SUPABASE_URL', `https://${projectRef}.supabase.co`);
    vi.stubEnv('SUPABASE_SESSION_POOLER_HOST', '');

    await expect(import('./approvalEngine.js')).rejects.toThrow('SUPABASE_SESSION_POOLER_HOST');
    expect(state.fromConnString).not.toHaveBeenCalled();
  });

  it('uses an explicitly selected in-memory saver for non-production sandbox work without DATABASE_URL', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'ephemeral');
    vi.stubEnv('DATABASE_URL', '');
    const { checkpointer, humanInTheLoopAgent } = await import('./approvalEngine.js');

    expect(state.MemorySaver).toHaveBeenCalledExactlyOnceWith();
    expect(state.fromConnString).not.toHaveBeenCalled();
    expect(checkpointer).toBe(state.memorySaver);
    expect(state.createReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointSaver: state.memorySaver,
        tools: [],
        interruptBefore: ['tools'],
      }),
    );
    expect(humanInTheLoopAgent).toBeDefined();
  });

  it('refuses ephemeral memory in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'ephemeral');
    vi.stubEnv('DATABASE_URL', '');

    await expect(import('./approvalEngine.js')).rejects.toThrow(
      'RYANAI_AGENT_MEMORY_MODE=ephemeral is disabled when NODE_ENV=production',
    );
    expect(state.MemorySaver).not.toHaveBeenCalled();
    expect(state.fromConnString).not.toHaveBeenCalled();
  });

  it('rejects unknown memory modes', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RYANAI_AGENT_MEMORY_MODE', 'local-file');

    await expect(import('./approvalEngine.js')).rejects.toThrow(
      'RYANAI_AGENT_MEMORY_MODE must be either "postgres" or "ephemeral"',
    );
    expect(state.MemorySaver).not.toHaveBeenCalled();
    expect(state.fromConnString).not.toHaveBeenCalled();
  });

  it('refuses to initialize persistent memory without PostgreSQL configuration', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', '');

    await expect(import('./approvalEngine.js')).rejects.toThrow(
      'DATABASE_URL is required for persistent RyanAI agent memory',
    );
    expect(state.MemorySaver).not.toHaveBeenCalled();
    expect(state.fromConnString).not.toHaveBeenCalled();
  });
});

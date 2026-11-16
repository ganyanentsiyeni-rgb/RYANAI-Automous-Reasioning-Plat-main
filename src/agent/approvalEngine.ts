import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { commsTools } from './tools/commsTools.js';
import { createChatModel } from '../config/llm.js';
import { resolveConnectionUrls } from '../server/startupConfig.js';

const llm = createChatModel();

// PostgreSQL remains the default and authoritative checkpointer. An explicitly
// selected in-memory saver is available only for disposable, non-production
// sandbox/test work; its checkpoints are lost when this process exits.
const memoryMode = (process.env.RYANAI_AGENT_MEMORY_MODE ?? 'postgres').trim().toLowerCase();

function createCheckpointer() {
  if (memoryMode === 'ephemeral') {
    if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
      throw new Error(
        'RYANAI_AGENT_MEMORY_MODE=ephemeral is disabled when NODE_ENV=production; configure PostgreSQL for production agent memory.',
      );
    }

    return new MemorySaver();
  }

  if (memoryMode !== 'postgres') {
    throw new Error(
      'RYANAI_AGENT_MEMORY_MODE must be either "postgres" or "ephemeral".',
    );
  }

  const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!configuredDatabaseUrl) {
    throw new Error(
      'DATABASE_URL is required for persistent RyanAI agent memory; refusing to use a local fallback.',
    );
  }

  // Keep LangGraph on the same validated Session Pooler route and TLS policy
  // as Prisma. Using raw DATABASE_URL here can bypass the project-qualified
  // pooler username and CA verification configured for the API runtime.
  const nodeEnv = (process.env.NODE_ENV ?? 'production').trim().toLowerCase();
  const { databaseUrl } = resolveConnectionUrls(
    nodeEnv,
    configuredDatabaseUrl,
    process.env.REDIS_URL,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SESSION_POOLER_HOST,
    process.env.SUPABASE_SSL_ROOT_CERT_PATH,
  );

  return PostgresSaver.fromConnString(databaseUrl);
}

export const checkpointer = createCheckpointer();

// Checkpoint tables are provisioned only by the explicit Prisma migration command.
// API startup verifies the schema and never calls PostgresSaver.setup(), which performs DDL.
// Agent tools are restricted to policy lookup and draft preparation. Provider sends
// remain in the owner-authenticated communications gateway and require owner action.
export const humanInTheLoopAgent = createReactAgent({
  llm,
  tools: commsTools,
  checkpointSaver: checkpointer,
  interruptBefore: ['tools'],
});

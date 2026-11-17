
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import {
  checkpointer,
  verifyPostgres,
} from "../db/langgraph-checkpointer.js";

interface RedisHealthClient {
  ping(): Promise<string>;
}

interface AgentRequest {
  tenantId: string;
  threadId: string;
  prompt: string;
}

type ReactAgentDependencies = Parameters<typeof createReactAgent>[0];

interface AgentDependencies {
  tools: ReactAgentDependencies["tools"];
  llm: ReactAgentDependencies["llm"];
  redis: RedisHealthClient;
}

export async function verifyWorkerDependencies(
  redis: RedisHealthClient
): Promise<void> {
  const postgresReady = await verifyPostgres();

  if (!postgresReady) {
    throw new Error("Agent worker blocked: PostgreSQL unavailable");
  }

  const redisResponse = await redis.ping();

  if (redisResponse !== "PONG") {
    throw new Error("Agent worker blocked: Redis unavailable");
  }

  console.log("[RyanAI Worker] Dependencies verified.");
}

export async function runAgent(
  request: AgentRequest,
  dependencies: AgentDependencies
) {
  const { tenantId, threadId, prompt } = request;
  const { tools, llm, redis } = dependencies;

  if (!tenantId || !threadId || !prompt.trim()) {
    throw new Error("Invalid agent request");
  }

  await verifyWorkerDependencies(redis);

  const graph = createReactAgent({
    tools,
    llm,
    checkpointSaver: checkpointer,
  });

  const result = await graph.invoke(
    {
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    },
    {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: tenantId,
      },
    }
  );

  return result;
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { invokeReasoningAgent } from '../agent/invoke.js';

interface ReasoningBody {
  prompt: string;
  model?: string;
  language?: string;
  responsePreferences?: unknown;
}

/** Stream persisted reasoning progress; authentication and execution policy remain server-owned. */
export async function reasoningRoutes(fastify: FastifyInstance) {
  fastify.post('/api/reasoning/stream', async (
    request: FastifyRequest<{ Body: ReasoningBody }>,
    reply: FastifyReply,
  ) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply.code(400).send({ error: 'Prompt is required for reasoning execution.' });
    }
    // Do not rely only on the global hook: this route independently fails closed.
    if (!request.authUser?.id) {
      return reply.code(401).send({ error: 'An authenticated user is required for reasoning execution.' });
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');

    try {
      const result = await invokeReasoningAgent({
        prompt,
        model: request.body?.model,
        language: request.body?.language,
        responsePreferences: request.body?.responsePreferences,
        user: request.authUser,
        onProgress: (event) => {
          if (reply.raw.destroyed || reply.raw.writableEnded) return;
          reply.raw.write(`data: ${JSON.stringify({
            status: 'processing',
            message: 'Reasoning ' + event.status + '; ' + event.handoffs.filter((handoff) => handoff.status === 'completed').length + ' specialist handoffs completed.',
          })}\\n\\n`);
        },
      });

      const lastMessage = result.messages[result.messages.length - 1];
      const output = typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify({ status: 'complete', result: output ?? '' })}\\n\\n`);
        reply.raw.end();
      }
    } catch {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify({ error: 'Reasoning execution failed. Please try again later.' })}\\n\\n`);
        reply.raw.end();
      }
    }
  });
}

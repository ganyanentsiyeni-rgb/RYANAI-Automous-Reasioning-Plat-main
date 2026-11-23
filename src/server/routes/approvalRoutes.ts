import { requireAdmin } from './auth.js';
import { FastifyPluginAsync } from 'fastify';
import { humanInTheLoopAgent } from '../../agent/approvalEngine.js';
import { enterpriseMultiAgent } from '../../agent/supervisorGraph.js';
import { notifyPendingApproval } from '../../utils/notifications.js';
import { prisma } from '../../lib/prisma.js';

interface WithApprovalBody {
  prompt: string;
  threadId: string;
}

interface ApproveBody {
  threadId: string;
  approved: boolean;
}

interface AdminResolveBody {
  approved: boolean;
}

const APPROVAL_TTL_MS = 30 * 60 * 1000;

/** Register admin-only routes to inspect, approve, or reject paused agent work. */
export const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  // 1. Initial Prompt Handler for Single Agent: Halts when a tool is called & triggers durable approval.
  fastify.post<{ Body: WithApprovalBody }>(
    '/api/reason/with-approval',
    async (request, reply) => {
      const { prompt, threadId } = request.body || {};
      if (!threadId || !prompt) {
        reply.status(400);
        return { error: 'Both prompt and threadId are required.' };
      }

      const config = { configurable: { thread_id: threadId } };

      await humanInTheLoopAgent.invoke(
        { messages: [{ role: 'user', content: prompt }] },
        config,
      );

      const currentState = await humanInTheLoopAgent.getState(config);

      if (currentState.next && currentState.next.includes('tools')) {
        const lastMessage = currentState.values?.messages?.at(-1);
        const pendingTool = lastMessage?.tool_calls?.[0];
        const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);

        // The approval decision is durable and owner/admin-bound. Graph checkpoint
        // state alone is not sufficient evidence of approval.
        const pendingAction = await prisma.pendingAction.create({
          data: {
            userId: request.authUser!.id,
            threadId,
            tool: pendingTool?.name || 'unknown_tool',
            args: pendingTool?.args || {},
            summary: `Approval required for tool ${pendingTool?.name || 'unknown_tool'}`,
            status: 'pending',
            expiresAt,
          },
          select: { id: true, expiresAt: true },
        });

        const notification = await notifyPendingApproval({
          threadId,
          tool: pendingTool?.name || 'unknown_tool',
          args: pendingTool?.args || {},
        });

        return {
          status: 'PENDING_APPROVAL',
          threadId,
          pendingActionId: pendingAction.id,
          pendingActionExpiresAt: pendingAction.expiresAt,
          pendingAction: {
            tool: pendingTool?.name,
            arguments: pendingTool?.args,
          },
          notification: notification.sent ? 'sent' : 'unavailable',
          message: notification.sent
            ? 'Tool execution paused. Approval is durably recorded and notification was dispatched.'
            : 'Tool execution paused. Approval is durably recorded; notification delivery is unavailable.',
        };
      }

      return {
        status: 'COMPLETED',
        response: currentState.values?.messages?.at(-1)?.content,
      };
    },
  );

  // 2. Resume Endpoint for Single Agent: durable decision is required before checkpoint resume.
  fastify.post<{ Body: ApproveBody }>(
    '/api/reason/approve',
    async (request, reply) => {
      const { threadId, approved } = request.body || {};
      if (!threadId) {
        reply.status(400);
        return { error: 'threadId is required.' };
      }

      const pendingAction = await prisma.pendingAction.findFirst({
        where: {
          threadId,
          userId: request.authUser!.id,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!pendingAction) {
        reply.status(409);
        return {
          status: 'BLOCKED',
          error: 'No active durable approval exists for this thread.',
        };
      }

      if (!approved) {
        await prisma.pendingAction.update({
          where: { id: pendingAction.id },
          data: {
            status: 'rejected',
            decidedAt: new Date(),
            decidedBy: request.authUser!.id,
            result: 'Rejected by administrator.',
          },
        });

        const rejectedResult = await humanInTheLoopAgent.invoke(
          {
            messages: [
              {
                role: 'user',
                content: 'Action rejected by admin. Do not execute the tool.',
              },
            ],
          },
          { configurable: { thread_id: threadId } },
        );

        return {
          status: 'REJECTED',
          pendingActionId: pendingAction.id,
          response: rejectedResult?.messages?.at(-1)?.content,
        };
      }

      await prisma.pendingAction.update({
        where: { id: pendingAction.id },
        data: {
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: request.authUser!.id,
        },
      });

      try {
        const approvedResult = await humanInTheLoopAgent.invoke(null, {
          configurable: { thread_id: threadId },
        });

        await prisma.pendingAction.update({
          where: { id: pendingAction.id },
          data: {
            status: 'executed',
            result: 'Approved and resumed successfully.',
          },
        });

        return {
          status: 'EXECUTED',
          pendingActionId: pendingAction.id,
          response: approvedResult?.messages?.at(-1)?.content,
        };
      } catch (error) {
        await prisma.pendingAction.update({
          where: { id: pendingAction.id },
          data: {
            status: 'failed',
            result: error instanceof Error ? error.message.slice(0, 500) : 'Approval resume failed.',
          },
        });
        throw error;
      }
    },
  );

  // 3. Multi-Agent Supergraph: Check current thread state for pending worker interrupts.
  fastify.get<{ Params: { threadId: string } }>(
    '/api/admin/threads/:threadId/pending',
    async (request) => {
      const { threadId } = request.params;
      const config = { configurable: { thread_id: threadId } };

      const state = await enterpriseMultiAgent.getState(config);

      if (!state.next || state.next.length === 0) {
        return {
          paused: false,
          message: 'No active interruptions on this thread.',
        };
      }

      const pendingAction = await prisma.pendingAction.findFirst({
        where: {
          threadId,
          userId: request.authUser!.id,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tool: true, args: true, expiresAt: true },
      });

      return {
        paused: true,
        nextNodes: state.next,
        pendingMessage: state.values?.messages?.at(-1),
        pendingAction,
      };
    },
  );

  // 4. Multi-Agent Supergraph: durable decision is required before resume.
  fastify.post<{ Params: { threadId: string }; Body: AdminResolveBody }>(
    '/api/admin/threads/:threadId/resolve',
    async (request, reply) => {
      const { threadId } = request.params;
      const { approved } = request.body || {};

      const pendingAction = await prisma.pendingAction.findFirst({
        where: {
          threadId,
          userId: request.authUser!.id,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!pendingAction) {
        reply.status(409);
        return {
          success: false,
          status: 'BLOCKED',
          error: 'No active durable approval exists for this thread.',
        };
      }

      try {
        await prisma.pendingAction.update({
          where: { id: pendingAction.id },
          data: {
            status: approved ? 'approved' : 'rejected',
            decidedAt: new Date(),
            decidedBy: request.authUser!.id,
            result: approved ? null : 'Rejected by administrator.',
          },
        });

        let result;
        if (approved) {
          result = await enterpriseMultiAgent.invoke(null, {
            configurable: { thread_id: threadId },
          });
          await prisma.pendingAction.update({
            where: { id: pendingAction.id },
            data: { status: 'executed', result: 'Approved and resumed successfully.' },
          });
        } else {
          result = await enterpriseMultiAgent.invoke(
            {
              messages: [
                {
                  role: 'user',
                  content: 'Execution rejected by administrator. Halt task processing.',
                },
              ],
            },
            { configurable: { thread_id: threadId } },
          );
        }

        return {
          success: true,
          status: approved ? 'EXECUTED' : 'REJECTED',
          pendingActionId: pendingAction.id,
          result,
        };
      } catch (err: unknown) {
        await prisma.pendingAction.update({
          where: { id: pendingAction.id },
          data: {
            status: 'failed',
            result: err instanceof Error ? err.message.slice(0, 500) : 'Approval resolution failed.',
          },
        });
        reply.status(500);
        return {
          success: false,
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Approval resolution failed.',
        };
      }
    },
  );
};

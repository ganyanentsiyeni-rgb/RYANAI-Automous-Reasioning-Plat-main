"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createRyanAiAgentUiBridge, type RyanAiAgentApprovalRequest } from "@/lib/agentUiBridge";

interface PendingApproval {
  id: number;
  summary: string;
}

/**
 * Keeps promise resolvers outside React render state while exposing only
 * methods to callbacks. Encapsulation avoids passing a ref-capturing callback
 * into the UI SDK bridge during render.
 */
class ApprovalRequestStore {
  private resolver: ((approved: boolean) => void) | null = null;
  private requestId = 0;

  begin(resolve: (approved: boolean) => void): number {
    this.resolver?.(false);
    const id = ++this.requestId;
    this.resolver = resolve;
    return id;
  }

  resolve(id: number, approved: boolean): void {
    if (id !== this.requestId || !this.resolver) return;
    const resolve = this.resolver;
    this.resolver = null;
    resolve(approved);
  }

  cancel(): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.requestId += 1;
    resolve?.(false);
  }
}

export function AgentUiApprovalController({
  children,
}: {
  children: (agent: ReturnType<typeof createRyanAiAgentUiBridge>) => ReactNode;
}) {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [approvalStore] = useState(() => new ApprovalRequestStore());
  const [agent, setAgent] = useState<ReturnType<typeof createRyanAiAgentUiBridge> | null>(null);

  const resolvePending = useCallback((id: number, approved: boolean) => {
    approvalStore.resolve(id, approved);
    setPending((current) => current?.id === id ? null : current);
  }, [approvalStore]);

  const requestApproval = useCallback(
    ({ summary, signal }: RyanAiAgentApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }

        const id = approvalStore.begin(resolve);
        setPending({ id, summary });

        const abort = () => {
          approvalStore.resolve(id, false);
          setPending((current) => current?.id === id ? null : current);
        };
        signal.addEventListener("abort", abort, { once: true });
      }),
    [approvalStore],
  );

  const releasePending = useCallback(() => {
    approvalStore.cancel();
  }, [approvalStore]);

  useEffect(() => {
    setAgent(createRyanAiAgentUiBridge({ requestApproval }));
    return () => releasePending();
  }, [requestApproval, releasePending]);

  return (
    <>
      {agent ? children(agent) : null}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-ui-approval-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        >
          <section className="w-full max-w-lg rounded-2xl border border-cyan-300/20 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              RyanAI agent approval
            </p>
            <h2 id="agent-ui-approval-title" className="mt-2 text-xl font-semibold text-white">
              Confirm requested UI action
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{pending.summary}</p>
            <p className="mt-3 text-xs text-slate-500">
              Approval only authorizes this UI action. Server authorization remains authoritative.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => resolvePending(pending.id, false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => resolvePending(pending.id, true)}
                className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/20"
              >
                Approve
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

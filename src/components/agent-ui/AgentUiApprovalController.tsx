"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createRyanAiAgentUiBridge, type RyanAiAgentApprovalRequest } from "@/lib/agentUiBridge";

interface PendingApproval {
  id: number;
  summary: string;
  signal: AbortSignal;
}

interface ApprovalStore {
  resolver: ((approved: boolean) => void) | null;
  requestId: number;
}

export function AgentUiApprovalController({
  children,
}: {
  children: (agent: ReturnType<typeof createRyanAiAgentUiBridge>) => ReactNode;
}) {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  // Stable, mutable bookkeeping for the single outstanding approval. It is only
  // read and written from callbacks and effects, never during render.
  const [store] = useState<ApprovalStore>(() => ({ resolver: null, requestId: 0 }));

  const resolvePending = useCallback((approved: boolean) => {
    const resolve = store.resolver;
    store.resolver = null;
    setPending(null);
    resolve?.(approved);
  }, [store]);

  const requestApproval = useCallback(
    ({ summary, signal }: RyanAiAgentApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }

        if (store.resolver) {
          store.resolver(false);
        }

        const id = ++store.requestId;
        store.resolver = resolve;
        setPending({ id, summary, signal });

        const abort = () => {
          if (store.requestId === id) resolvePending(false);
        };
        signal.addEventListener("abort", abort, { once: true });
      }),
    [resolvePending, store],
  );

  useEffect(() => {
    return () => {
      store.resolver?.(false);
      store.resolver = null;
    };
  }, [store]);

  const agent = createRyanAiAgentUiBridge({ requestApproval });

  return (
    <>
      {children(agent)}
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
                onClick={() => resolvePending(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => resolvePending(true)}
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

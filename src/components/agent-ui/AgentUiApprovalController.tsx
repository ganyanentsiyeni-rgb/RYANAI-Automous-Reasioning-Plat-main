"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRyanAiAgentUiBridge, type RyanAiAgentApprovalRequest } from "@/lib/agentUiBridge";

interface PendingApproval {
  id: number;
  summary: string;
  signal: AbortSignal;
}

export function AgentUiApprovalController({
  children,
}: {
  children: (agent: ReturnType<typeof createRyanAiAgentUiBridge>) => ReactNode;
}) {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const resolverRef = useRef<((approved: boolean) => void) | null>(null);
  const requestIdRef = useRef(0);

  const resolvePending = useCallback((approved: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(approved);
  }, []);

  const requestApproval = useCallback(
    ({ summary, signal }: RyanAiAgentApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }

        if (resolverRef.current) {
          resolverRef.current(false);
        }

        const id = ++requestIdRef.current;
        resolverRef.current = resolve;
        setPending({ id, summary, signal });

        const abort = () => {
          if (requestIdRef.current === id) resolvePending(false);
        };
        signal.addEventListener("abort", abort, { once: true });
      }),
    [resolvePending],
  );

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

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

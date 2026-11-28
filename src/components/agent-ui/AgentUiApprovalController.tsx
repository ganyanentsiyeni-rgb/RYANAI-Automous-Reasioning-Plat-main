"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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

type AgentUiBridge = ReturnType<typeof createRyanAiAgentUiBridge>;

/** External-store adapter lets the bridge be created in an effect without
 * scheduling React state updates directly from that effect. */
class AgentUiBridgeStore {
  private agent: AgentUiBridge | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.agent;

  publish(agent: AgentUiBridge | null): void {
    this.agent = agent;
    this.listeners.forEach((listener) => listener());
  }
}

export function AgentUiApprovalController({
  children,
}: {
  children: (agent: AgentUiBridge) => ReactNode;
}) {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const declineButtonRef = useRef<HTMLButtonElement>(null);
  const [approvalStore] = useState(() => new ApprovalRequestStore());
  const [bridgeStore] = useState(() => new AgentUiBridgeStore());
  const agent = useSyncExternalStore(bridgeStore.subscribe, bridgeStore.getSnapshot, bridgeStore.getSnapshot);

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
    if (!pending) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    declineButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resolvePending(pending.id, false);
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) {
        queueMicrotask(() => {
          if (previouslyFocused.isConnected) previouslyFocused.focus();
        });
      }
    };
  }, [pending?.id, resolvePending]);

  useEffect(() => {
    bridgeStore.publish(createRyanAiAgentUiBridge({ requestApproval }));
    return () => {
      bridgeStore.publish(null);
      releasePending();
    };
  }, [bridgeStore, requestApproval, releasePending]);

  return (
    <>
      {agent ? children(agent) : null}
      {pending && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-ui-approval-title"
          aria-describedby="agent-ui-approval-summary"
          tabIndex={-1}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        >
          <section className="w-full max-w-lg rounded-2xl border border-cyan-300/20 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              RyanAI agent approval
            </p>
            <h2 id="agent-ui-approval-title" className="mt-2 text-xl font-semibold text-white">
              Confirm requested UI action
            </h2>
            <p id="agent-ui-approval-summary" className="mt-3 text-sm leading-6 text-slate-300">{pending.summary}</p>
            <p className="mt-3 text-xs text-slate-500">
              Approval only authorizes this UI action. Server authorization remains authoritative.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                ref={declineButtonRef}
                onClick={() => resolvePending(pending.id, false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => resolvePending(pending.id, true)}
                className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
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

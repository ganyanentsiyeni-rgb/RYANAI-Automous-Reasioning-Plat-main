// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ui-sdk/react/agent", () => ({
  createAgent: ({ allow }: {
    allow: (step: { confirm?: string }, context: { signal: AbortSignal }) => boolean | Promise<boolean>;
  }) => ({
    act: async ({ steps }: { steps: Array<{ confirm?: string }> }) => {
      for (const step of steps) {
        if (step.confirm && !await allow(step, { signal: new AbortController().signal })) return false;
      }
      return true;
    },
  }),
}));

import { AgentUiApprovalController } from "./AgentUiApprovalController";

describe("AgentUiApprovalController", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("renders an app-owned approval surface for a confirmed UI action", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    let requestAction: (() => Promise<unknown>) | undefined;
    let actPromise: Promise<unknown> | undefined;

    await act(async () => {
      root.render(
        <AgentUiApprovalController>
          {(agent) => {
            requestAction = () => agent.act({
              steps: [{
                ref: "missing",
                action: "click",
                confirm: "Run the requested UI action?",
              }],
            });
            return <button type="button">Agent host</button>;
          }}
        </AgentUiApprovalController>,
      );
    });

    await act(async () => {
      actPromise = requestAction?.();
      await Promise.resolve();
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("Run the requested UI action?");

    const approve = Array.from(dialog!.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve",
    );
    expect(approve).toBeTruthy();

    await act(async () => {
      approve?.click();
      await actPromise;
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

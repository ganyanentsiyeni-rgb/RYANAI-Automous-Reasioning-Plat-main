// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentUiApprovalController } from "./AgentUiApprovalController";

describe("AgentUiApprovalController", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("renders the approval surface and resolves approval", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    let agent: ReturnType<typeof import("@/lib/agentUiBridge").createRyanAiAgentUiBridge> | undefined;

    await act(async () => {
      root.render(
        <AgentUiApprovalController>
          {(nextAgent) => {
            agent = nextAgent;
            return <button type="button">Agent host</button>;
          }}
        </AgentUiApprovalController>,
      );
    });

    expect(agent).toBeDefined();

    const resultPromise = agent!.act({
      steps: [
        {
          ref: "missing",
          action: "click",
          confirm: "Run the requested UI action?",
        },
      ],
    });

    await act(async () => {
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
    });

    await resultPromise;
    expect(dialog?.textContent).toContain("Run the requested UI action?");
  });

  it("fails closed when the approval signal is aborted", async () => {
    const controller = new AbortController();
    const approval = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      if (signal.aborted) return false;
      return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true }));
    });

    controller.abort();
    expect(await approval({ signal: controller.signal })).toBe(false);
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentReadyTaskFilter, type AgentReadyTaskFilterValue } from "./AgentReadyTaskFilter";

describe("AgentReadyTaskFilter", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("is discoverable and changeable through the UI SDK agent bridge", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onChange = vi.fn<(value: AgentReadyTaskFilterValue) => void>();
    const agent = createAgent();

    await act(async () => {
      root.render(
        <AgentReadyTaskFilter value="all" onChange={onChange} />,
      );
    });

    const filter = agent.snapshot().find((entry) => entry.label === "Filter tasks");
    expect(filter).toBeDefined();
    expect(filter?.actions).toContain("setValue");

    const result = await agent.act({
      steps: [{ ref: "Filter tasks", action: "setValue", args: ["running"] }],
    });

    expect(result.ok, result.error?.message).toBe(true);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBe("running");
  });
});

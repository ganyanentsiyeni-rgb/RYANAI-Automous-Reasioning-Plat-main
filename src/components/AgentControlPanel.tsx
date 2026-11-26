import React, { useState } from "react";
import { TauriBridge, type AgentResponse } from "../services/tauriBridge";

/** Render an authenticated reasoning console with durable execution evidence. */
export function AgentControlPanel() {
  const [objective, setObjective] = useState("");
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRunObjective = async () => {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective || loading) return;
    setLoading(true);
    setError("");
    setResponse(null);

    try {
      setResponse(await TauriBridge.executeObjective(normalizedObjective));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      aria-labelledby="native-reasoning-title"
    >
      <h2 id="native-reasoning-title" className="mb-2 text-xl font-bold">RyanAI Native Reasoning Console</h2>
      <p className="mb-4 text-sm text-slate-400">
        Send a reasoning objective through your signed-in RyanAI account. Administrative and engineering actions remain subject to their separate permissions and approvals.
      </p>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          maxLength={20000}
          aria-label="Reasoning objective"
          placeholder="Describe a question or reasoning task…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 focus:border-cyan-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleRunObjective()}
          disabled={loading || !objective.trim()}
          className="rounded-lg bg-cyan-500 px-6 py-2 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Reasoning…" : "Run request"}
        </button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-300/20 bg-rose-950/20 p-3 text-sm text-rose-200">Request failed: {error}</p>}

      {response && (
        <div className="space-y-3" role="status" aria-live="polite">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">AgentRun</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-200">{response.runId || "Not returned"}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Execution status</p>
              <p className="mt-1 text-xs font-semibold text-cyan-200">{response.status}</p>
            </div>
          </div>

          {response.handoffs && response.handoffs.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Persisted handoffs</p>
              <div className="mt-2 space-y-2">
                {response.handoffs.map((handoff, index) => (
                  <div key={`${handoff.fromAgent}-${handoff.toAgent}-${index}`} className="rounded-md border border-slate-800 px-2 py-2 text-xs text-slate-300">
                    <span className="font-semibold">{handoff.fromAgent} → {handoff.toAgent}</span>
                    <span className="ml-2 text-slate-500">{handoff.status || "recorded"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="min-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/50 p-4 font-mono text-sm">
            {response.result || "RyanAI returned no reasoning output."}
          </div>
        </div>
      )}

      {!response && !error && (
        <div role="status" aria-live="polite" className="min-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/50 p-4 font-mono text-sm">
          {loading ? "Submitting a durable reasoning request…" : "Waiting for a signed-in reasoning request…"}
        </div>
      )}
    </section>
  );
}
